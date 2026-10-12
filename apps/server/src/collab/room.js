import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';
import { LIMITS } from '@syncspace/shared';
import {
  CloseCode,
  encodeAwareness,
  encodeControl,
  encodeHeartbeat,
  encodeSyncStep1,
  encodeSyncStep2,
  encodeUpdate,
  MessageType,
  ProtocolError,
} from '@syncspace/shared/protocol';
import { LOAD_ORIGIN } from './store.js';

const MAX_AWARENESS_ENTRIES = 8;

/** Origin used for changes made by the server itself (title rename, version restore). */
export class ServerChange {
  constructor({ userId, reason }) {
    this.userId = userId ?? null;
    this.reason = reason;
  }
}

/**
 * The live, in-memory replica of one document plus everyone connected to it.
 *
 * Durability rule: every effective change is appended to MongoDB by a single serial write
 * queue, and an Ack for a client frame is queued behind the writes that frame caused. Acks
 * therefore mean "stored", never just "received". If a write fails the room evicts itself and
 * disconnects everyone: clients still hold their unacknowledged changes and resend them after
 * reconnecting to a freshly loaded replica.
 */
export class DocRoom {
  constructor({ docId, workspaceId, ydoc, lastSeq, uncheckpointed, store, hooks, metrics, logger, settings, onClosed }) {
    this.docId = docId;
    this.workspaceId = String(workspaceId);
    this.ydoc = ydoc;
    this.seq = lastSeq;
    this.uncheckpointed = uncheckpointed;
    this.store = store;
    this.hooks = hooks;
    this.metrics = metrics;
    this.logger = logger.child({ docId });
    this.settings = settings;
    this.onClosed = onClosed;

    this.conns = new Set();
    this.leases = 0;
    this.changeCount = 0;
    this.clientOwners = new Map();
    this.queue = [];
    this.flushing = null;
    this.closed = false;
    this.unloadTimer = null;

    this.changedSinceVersion = false;
    this.lastVersionAt = Date.now();
    this.contributors = new Set();
    this.editorsSinceDerived = new Set();
    this.lastEditorId = null;
    this.derivedTimer = null;

    this.awareness = new awarenessProtocol.Awareness(ydoc);
    this.awareness.setLocalState(null);
    this.awareness.on('update', this.#onAwarenessUpdate);
    ydoc.on('update', this.#onDocUpdate);
  }

  // ---- Connections ---------------------------------------------------------------------

  addConnection(conn) {
    if (this.closed) throw new Error('Room is closed');
    clearTimeout(this.unloadTimer);
    this.unloadTimer = null;
    this.conns.add(conn);
    conn.room = this;
    conn.sendControl({ kind: 'hello', role: conn.role, user: conn.identity, docId: this.docId });
    conn.send(encodeSyncStep1(Y.encodeStateVector(this.ydoc)));
    const present = [...this.awareness.getStates().keys()];
    if (present.length > 0) {
      conn.send(encodeAwareness(awarenessProtocol.encodeAwarenessUpdate(this.awareness, present)));
    }
  }

  removeConnection(conn) {
    if (!this.conns.delete(conn)) return;
    const owned = [...conn.awarenessClientIds].filter((id) => this.clientOwners.get(id) === conn);
    for (const id of owned) this.clientOwners.delete(id);
    if (owned.length > 0) awarenessProtocol.removeAwarenessStates(this.awareness, owned, conn);
    if (this.conns.size === 0 && !this.closed) {
      clearTimeout(this.unloadTimer);
      this.unloadTimer = setTimeout(() => this.onClosed?.(this, 'idle'), this.settings.unloadDelayMs);
      this.unloadTimer.unref?.();
    }
  }

  broadcast(bytes, except = null) {
    for (const conn of this.conns) if (conn !== except) conn.send(bytes);
  }

  // ---- Messages ------------------------------------------------------------------------

  handleMessage(conn, message) {
    switch (message.type) {
      case MessageType.SyncStep1:
        conn.send(encodeSyncStep2(Y.encodeStateAsUpdate(this.ydoc, message.stateVector)));
        return;
      case MessageType.SyncStep2:
      case MessageType.Update:
        this.#handleClientUpdate(conn, message);
        return;
      case MessageType.Awareness:
        this.#handleAwareness(conn, message.update);
        return;
      case MessageType.Checkpoint:
        this.#enqueue({ kind: 'ack', conn, ackId: message.ackId });
        return;
      case MessageType.Heartbeat:
        conn.send(encodeHeartbeat());
        return;
      default:
        throw new ProtocolError(`Clients may not send message type ${message.type}`);
    }
  }

  #handleClientUpdate(conn, { update, ackId }) {
    this.metrics.inc('updatesReceived');
    if (!conn.canEdit) {
      // A viewer's frame is acknowledged only if it carries nothing new. Otherwise the client is
      // told plainly that its changes cannot be saved, and keeps them (no ack = still pending).
      if (wouldChange(this.ydoc, update)) {
        this.metrics.inc('readOnlyRejections');
        if (!conn.readOnlyNotified) {
          conn.readOnlyNotified = true;
          conn.sendControl({
            kind: 'error',
            code: 'read_only',
            message: 'Your role in this workspace is viewer, so changes from this device cannot be saved.',
          });
        }
        return;
      }
      if (ackId) this.#enqueue({ kind: 'ack', conn, ackId });
      return;
    }

    Y.applyUpdate(this.ydoc, update, conn);
    // Content whose dependencies have not arrived yet is held by Yjs as "pending" and is not part
    // of any emitted update; keep the raw frame so it is durable too. Replaying it is idempotent.
    if (this.ydoc.store.pendingStructs || this.ydoc.store.pendingDs) {
      this.#enqueue({ kind: 'persist', update, userId: conn.userId });
    }
    if (ackId) this.#enqueue({ kind: 'ack', conn, ackId });
  }

  /**
   * Presence is sanitised on the way in: a connection may only speak for awareness client IDs
   * it introduced, and the `user` field is always overwritten with the server-authenticated
   * identity, so nobody can appear as someone else.
   */
  #handleAwareness(conn, payload) {
    if (payload.byteLength > LIMITS.awarenessMaxBytes) throw new ProtocolError('Awareness update too large');
    const decoder = decoding.createDecoder(payload);
    const count = decoding.readVarUint(decoder);
    if (count > MAX_AWARENESS_ENTRIES) throw new ProtocolError('Too many awareness entries');
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, count);
    for (let index = 0; index < count; index += 1) {
      const clientId = decoding.readVarUint(decoder);
      const clock = decoding.readVarUint(decoder);
      let state = JSON.parse(decoding.readVarString(decoder));
      const owner = this.clientOwners.get(clientId);
      if (owner && owner !== conn) throw new ProtocolError('Awareness client ID belongs to another connection');
      if (state !== null) {
        if (typeof state !== 'object' || Array.isArray(state)) throw new ProtocolError('Awareness state must be an object');
        state = { ...state, user: { ...conn.identity, role: conn.role } };
      }
      this.clientOwners.set(clientId, conn);
      conn.awarenessClientIds.add(clientId);
      encoding.writeVarUint(encoder, clientId);
      encoding.writeVarUint(encoder, clock);
      encoding.writeVarString(encoder, JSON.stringify(state));
    }
    if (decoding.hasContent(decoder)) throw new ProtocolError('Trailing bytes in awareness update');
    awarenessProtocol.applyAwarenessUpdate(this.awareness, encoding.toUint8Array(encoder), conn);
  }

  #onAwarenessUpdate = ({ added, updated, removed }, origin) => {
    const changed = [...added, ...updated, ...removed];
    if (changed.length === 0) return;
    const bytes = encodeAwareness(awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
    this.broadcast(bytes, this.conns.has(origin) ? origin : null);
  };

  #onDocUpdate = (update, origin) => {
    if (origin === LOAD_ORIGIN || this.closed) return;
    const sourceConn = this.conns.has(origin) ? origin : null;
    const userId = sourceConn?.userId ?? (origin instanceof ServerChange ? origin.userId : null);
    this.metrics.inc('updatesApplied');
    this.broadcast(encodeUpdate(update), sourceConn);
    this.#enqueue({ kind: 'persist', update, userId });
    this.#markChanged(userId);
  };

  // ---- Server-side changes ---------------------------------------------------------------

  /** Applies a change made by the server and resolves once it is durably stored. */
  async applyServerChange(change, origin) {
    this.ydoc.transact(() => change(this.ydoc), origin);
    await this.barrier();
  }

  /** Resolves when every write queued before this call has completed. */
  barrier() {
    return this.runTask(async () => {});
  }

  /** Runs `task` in the write queue, after all previously queued writes. */
  runTask(task) {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error('Room is closed'));
        return;
      }
      this.#enqueue({ kind: 'task', task, resolve, reject });
    });
  }

  // ---- Write queue ---------------------------------------------------------------------

  #enqueue(job) {
    if (this.closed) return;
    this.queue.push(job);
    // Start the flush in a microtask: an async function with no await inside would otherwise run
    // to completion (clearing `flushing` in its finally) before this assignment, leaving the
    // queue permanently marked as busy.
    this.flushing ??= Promise.resolve().then(() => this.#flush());
  }

  async #flush() {
    try {
      while (this.queue.length > 0 && !this.closed) {
        const batch = this.queue.splice(0);
        const writes = batch.filter((job) => job.kind === 'persist');
        if (writes.length > 0) {
          const entries = writes.map((job) => ({ seq: ++this.seq, update: job.update, userId: job.userId }));
          const startedAt = performance.now();
          await this.store.append(this.docId, entries);
          this.metrics.observe('persistMs', performance.now() - startedAt);
          this.metrics.inc('updatesPersisted', entries.length);
          this.metrics.inc('persistBatches');
          this.uncheckpointed += entries.length;
        }
        for (const job of batch) {
          if (job.kind === 'ack') job.conn.sendAck(job.ackId);
          else if (job.kind === 'task') await this.#runQueuedTask(job);
        }
        if (this.uncheckpointed >= this.settings.compactAfterUpdates) await this.#compact();
      }
    } catch (error) {
      this.fail(error);
    } finally {
      this.flushing = null;
    }
  }

  async #runQueuedTask(job) {
    try {
      job.resolve(await job.task());
    } catch (error) {
      job.reject(error);
    }
  }

  async #compact() {
    if (this.uncheckpointed === 0) return;
    const seq = this.seq;
    try {
      await this.store.checkpoint(this.docId, Y.encodeStateAsUpdate(this.ydoc), seq);
      this.uncheckpointed = 0;
      this.metrics.inc('compactions');
    } catch (error) {
      // The update log is still complete, so a failed compaction loses nothing; retry later.
      this.metrics.inc('compactionFailures');
      this.logger.warn({ err: { message: error.message } }, 'Compaction failed');
      this.uncheckpointed = Math.max(0, this.settings.compactAfterUpdates - 20);
    }
  }

  // ---- Derived data and history -------------------------------------------------------------

  #markChanged(userId) {
    this.changeCount += 1;
    this.changedSinceVersion = true;
    if (userId) {
      const id = String(userId);
      this.contributors.add(id);
      this.editorsSinceDerived.add(id);
      this.lastEditorId = id;
    }
    if (!this.derivedTimer) {
      this.derivedTimer = setTimeout(() => this.flushDerived(), this.settings.derivedDelayMs);
      this.derivedTimer.unref?.();
    }
    if (Date.now() - this.lastVersionAt >= this.settings.autoVersionIntervalMs) {
      this.lastVersionAt = Date.now();
      this.runTask(() => this.snapshotVersion({ kind: 'auto' })).catch((error) =>
        this.logger.warn({ err: { message: error.message } }, 'Automatic version failed'),
      );
    }
  }

  async flushDerived() {
    clearTimeout(this.derivedTimer);
    this.derivedTimer = null;
    const editors = [...this.editorsSinceDerived];
    this.editorsSinceDerived.clear();
    try {
      await this.hooks.onContentChanged(this, editors);
    } catch (error) {
      this.logger.warn({ err: { message: error.message } }, 'Could not update document metadata');
    }
  }

  /** Must run inside the write queue so the snapshot reflects exactly what is stored. */
  async snapshotVersion({ kind, label, createdBy, restoredFrom }) {
    const version = await this.hooks.createVersion(this, { kind, label, createdBy, restoredFrom });
    this.changedSinceVersion = false;
    this.lastVersionAt = Date.now();
    this.contributors.clear();
    this.metrics.inc('versionsCreated');
    return version;
  }

  // ---- Lifecycle -----------------------------------------------------------------------

  /** Flushes derived metadata, records a final version if needed, compacts, then closes. */
  async drainAndClose() {
    if (this.closed) return;
    await this.runTask(async () => {
      await this.flushDerived();
      if (this.changedSinceVersion) await this.snapshotVersion({ kind: 'auto' });
      await this.#compact();
    }).catch((error) => this.logger.warn({ err: { message: error.message } }, 'Final room tasks failed'));
    this.destroy();
  }

  fail(error) {
    if (this.closed) return;
    this.metrics.inc('persistFailures');
    this.logger.error({ err: { name: error.name, message: error.message } }, 'Persistence failed; evicting room');
    for (const conn of this.conns) {
      conn.send(encodeControl({ kind: 'error', code: 'persistence_failed', message: 'The server could not store recent changes.' }));
      conn.close(CloseCode.PersistenceFailure, 'persistence_failed');
    }
    this.destroy();
  }

  closeAll(code, reason, control) {
    for (const conn of this.conns) {
      if (control) conn.sendControl(control);
      conn.close(code, reason);
    }
  }

  destroy() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.unloadTimer);
    clearTimeout(this.derivedTimer);
    for (const job of this.queue.splice(0)) if (job.kind === 'task') job.reject(new Error('Room closed'));
    this.awareness.off('update', this.#onAwarenessUpdate);
    this.awareness.destroy();
    this.ydoc.off('update', this.#onDocUpdate);
    this.ydoc.destroy();
    this.onClosed?.(this, 'destroyed');
  }
}

/** True if applying `update` would change `ydoc`. Uses a scratch copy; `ydoc` is untouched. */
export function wouldChange(ydoc, update) {
  const probe = new Y.Doc();
  Y.applyUpdate(probe, Y.encodeStateAsUpdate(ydoc));
  let changed = false;
  probe.on('update', () => {
    changed = true;
  });
  try {
    Y.applyUpdate(probe, update);
  } finally {
    probe.destroy();
  }
  return changed;
}
