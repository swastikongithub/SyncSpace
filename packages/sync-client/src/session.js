import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';
import { can } from '@syncspace/shared/roles';
import {
  decodeMessage,
  encodeAwareness,
  encodeHeartbeat,
  encodeSyncStep1,
  encodeSyncStep2,
  encodeUpdate,
  MessageType,
  TERMINAL_CLOSE_CODES,
} from '@syncspace/shared/protocol';
import { Emitter } from './emitter.js';
import { LOCAL_LOAD, REMOTE } from './origins.js';

const OPEN = 1;

const DEFAULTS = Object.freeze({
  minBackoffMs: 500,
  maxBackoffMs: 15_000,
  batchMs: 25,
  heartbeatIntervalMs: 20_000,
  heartbeatTimeoutMs: 10_000,
});

/**
 * One document's replica on this device: a Y.Doc kept in step with local storage and the server.
 *
 * Versions: every local change increments `localVersion` (persisted with the change). Each frame
 * sent to the server carries an ackId mapped to the localVersion it covers; the server's Ack
 * means everything up to that version is stored in MongoDB, which advances `durableVersion`.
 * `localVersion - durableVersion` is therefore an exact, persistent count of changes that exist
 * only on this device.
 *
 * Emits: 'change' (state snapshot), 'recovery' ({ state }), 'restored', 'role', 'server-error'.
 */
export class DocSyncSession extends Emitter {
  constructor({ docId, url, createSocket, storage = null, network = null, options = {} }) {
    super();
    this.docId = docId;
    this.url = url;
    this.createSocket = createSocket;
    this.storage = storage;
    this.network = network;
    this.options = { ...DEFAULTS, ...options };

    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);

    this.socket = null;
    this.generation = 0;
    this.attempt = 0;
    this.acks = new Map();
    this.nextAckId = 1;
    this.outgoing = [];
    this.step2Sent = false;
    this.recoveryGuard = null;
    this.timers = { retry: null, flush: null, heartbeat: null };
    this.lastMessageAt = 0;
    this.writeChain = Promise.resolve();
    this.destroyed = false;
    this.started = false;

    this.state = {
      connection: 'idle',
      retryAt: null,
      role: null,
      serverSynced: false,
      hasLocalCopy: false,
      localVersion: 0,
      savedVersion: 0,
      durableVersion: 0,
      localWritesPending: 0,
      localError: null,
      blocked: null,
      readOnlyRejected: false,
      lastServerContactAt: null,
      lastAckLatencyMs: null,
      reconnects: 0,
    };
  }

  // ---- Public API ------------------------------------------------------------------------

  get pendingCount() {
    return Math.max(0, this.state.localVersion - this.state.durableVersion);
  }

  get canEdit() {
    return this.state.role ? can(this.state.role, 'doc.edit') : false;
  }

  getState() {
    return this.state;
  }

  async start() {
    if (this.started) return;
    this.started = true;
    if (this.storage) {
      try {
        const local = await this.storage.load(this.docId);
        if (local && local.updates.length > 0) {
          this.doc.transact(() => {
            for (const update of local.updates) Y.applyUpdate(this.doc, update, LOCAL_LOAD);
          }, LOCAL_LOAD);
          const { localVersion = 0, durableVersion = 0 } = local.meta ?? {};
          this.#set({ hasLocalCopy: true, localVersion, savedVersion: localVersion, durableVersion });
        }
      } catch (error) {
        this.#set({ localError: describeError(error) });
      }
    }
    if (this.destroyed) return;
    this.doc.on('update', this.#onDocUpdate);
    this.doc.on('afterTransaction', this.#guardUnsyncedContent);
    this.awareness.on('update', this.#onAwarenessUpdate);
    this.unsubscribeNetwork = this.network?.subscribe((online) => (online ? this.#onOnline() : this.#onOffline()));
    this.#connect();
  }

  /** Reconnects now (after signing in again, a role change, or a manual retry). */
  reconnect() {
    if (this.destroyed) return;
    this.attempt = 0;
    this.#dropSocket(1000, 'reconnect');
    this.#set({ blocked: null, serverSynced: false });
    this.#connect();
  }

  setPresence(fields) {
    const current = this.awareness.getLocalState() ?? {};
    this.awareness.setLocalState({ ...current, ...fields });
  }

  /** Resolves when local storage has every change made so far. */
  async whenSavedLocally() {
    await this.writeChain;
  }

  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const timer of Object.values(this.timers)) clearTimeout(timer);
    clearInterval(this.timers.heartbeat);
    this.unsubscribeNetwork?.();
    if (this.awareness.getLocalState() !== null) this.awareness.setLocalState(null);
    this.#dropSocket(1000, 'closed');
    await this.writeChain.catch(() => {});
    this.awareness.destroy();
    this.doc.off('update', this.#onDocUpdate);
    this.doc.off('afterTransaction', this.#guardUnsyncedContent);
    this.doc.destroy();
    this.clearListeners();
  }

  // ---- Local changes ---------------------------------------------------------------------

  #onDocUpdate = (update, origin) => {
    if (origin === LOCAL_LOAD) return;
    if (origin === REMOTE) {
      this.#persist(update, null);
      return;
    }
    const version = this.state.localVersion + 1;
    this.#set({ localVersion: version, hasLocalCopy: this.state.hasLocalCopy || Boolean(this.storage) });
    this.#persist(update, version);
    if (this.#canSend()) {
      this.outgoing.push(update);
      this.timers.flush ??= setTimeout(() => this.#flush(), this.options.batchMs);
    }
    this.#publishUnsynced();
  };

  #persist(update, version) {
    if (!this.storage) return;
    this.#set({ localWritesPending: this.state.localWritesPending + 1 });
    this.writeChain = this.writeChain
      .then(() => this.storage.storeUpdate(this.docId, update, version))
      .then(
        () => {
          const savedVersion = version ? Math.max(this.state.savedVersion, version) : this.state.savedVersion;
          this.#set({ savedVersion, localError: null, localWritesPending: this.state.localWritesPending - 1 });
        },
        (error) => {
          this.#set({ localError: describeError(error), localWritesPending: this.state.localWritesPending - 1 });
        },
      );
  }

  #flush() {
    this.timers.flush = null;
    if (this.outgoing.length === 0 || !this.#canSend()) return;
    const merged = this.outgoing.length === 1 ? this.outgoing[0] : Y.mergeUpdates(this.outgoing);
    this.outgoing = [];
    this.#send(encodeUpdate(merged, this.#ackFor(this.state.localVersion)));
  }

  #canSend() {
    return this.socket?.readyState === OPEN && this.step2Sent;
  }

  #ackFor(coversUpTo) {
    const ackId = this.nextAckId;
    this.nextAckId += 1;
    this.acks.set(ackId, { coversUpTo, sentAt: Date.now() });
    return ackId;
  }

  // ---- Connection --------------------------------------------------------------------------

  #connect() {
    if (this.destroyed || this.state.blocked || this.socket) return;
    clearTimeout(this.timers.retry);
    this.timers.retry = null;
    if (this.network && !this.network.isOnline()) {
      this.#set({ connection: 'offline', retryAt: null });
      return;
    }
    this.#set({ connection: 'connecting', retryAt: null });
    const generation = ++this.generation;
    let socket;
    try {
      socket = this.createSocket(this.url);
    } catch {
      this.#scheduleReconnect();
      return;
    }
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    const current = () => generation === this.generation && !this.destroyed;
    socket.onopen = () => current() && this.#onOpen();
    socket.onmessage = (event) => current() && this.#onMessage(event.data);
    socket.onclose = (event) => current() && this.#onClose(event.code, event.reason);
    socket.onerror = () => {};
  }

  #onOpen() {
    this.acks.clear();
    this.nextAckId = 1;
    this.outgoing = [];
    this.step2Sent = false;
    this.lastMessageAt = Date.now();
    this.#set({ connection: 'handshaking' });
    this.#send(encodeSyncStep1(Y.encodeStateVector(this.doc)));
    if (this.awareness.getLocalState() !== null) {
      this.#send(encodeAwareness(awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID])));
    }
    clearInterval(this.timers.heartbeat);
    this.timers.heartbeat = setInterval(() => this.#heartbeat(), this.options.heartbeatIntervalMs);
  }

  #heartbeat() {
    if (!this.socket || this.socket.readyState !== OPEN) return;
    const silentFor = Date.now() - this.lastMessageAt;
    if (silentFor > this.options.heartbeatIntervalMs + this.options.heartbeatTimeoutMs) {
      // The connection is dead without a close event (e.g. the network vanished). Treat it as
      // closed now rather than waiting for the operating system to notice.
      this.#dropSocket(4000, 'heartbeat_timeout');
      this.#onClose(1006, 'heartbeat_timeout');
      return;
    }
    this.#send(encodeHeartbeat());
  }

  #onMessage(data) {
    this.lastMessageAt = Date.now();
    let message;
    try {
      message = decodeMessage(data);
    } catch {
      this.#dropSocket(4400, 'invalid_message');
      this.#onClose(4400, 'invalid_message');
      return;
    }
    switch (message.type) {
      case MessageType.Control:
        this.#onControl(message.control);
        break;
      case MessageType.SyncStep1:
        this.#sendStep2(message.stateVector);
        break;
      case MessageType.SyncStep2:
        Y.applyUpdate(this.doc, message.update, REMOTE);
        this.attempt = 0;
        if (!this.state.serverSynced) this.storage?.markSynced?.(this.docId)?.catch(() => {});
        this.#set({ connection: 'connected', serverSynced: true, hasLocalCopy: Boolean(this.storage), lastServerContactAt: Date.now() });
        break;
      case MessageType.Update:
        Y.applyUpdate(this.doc, message.update, REMOTE);
        break;
      case MessageType.Awareness:
        awarenessProtocol.applyAwarenessUpdate(this.awareness, message.update, REMOTE);
        break;
      case MessageType.Ack:
        this.#onAck(message.ackId);
        break;
      default:
        break;
    }
  }

  #sendStep2(serverStateVector) {
    const pending = this.pendingCount > 0;
    if (pending) {
      // Until the server confirms it has our offline changes, watch for remote deletions that
      // remove content only this device has (see #guardUnsyncedContent).
      this.recoveryGuard = {
        known: Y.decodeStateVector(serverStateVector),
        preState: Y.encodeStateAsUpdate(this.doc),
        ackId: null,
        triggered: false,
      };
    }
    if (this.canEdit || pending) {
      const ackId = this.#ackFor(this.state.localVersion);
      if (this.recoveryGuard) this.recoveryGuard.ackId = ackId;
      this.#send(encodeSyncStep2(Y.encodeStateAsUpdate(this.doc, serverStateVector), ackId));
    }
    this.step2Sent = true;
    this.outgoing = [];
    clearTimeout(this.timers.flush);
    this.timers.flush = null;
  }

  /**
   * CRDTs let a deletion win over concurrent edits inside the deleted range. If a collaborator
   * deleted a paragraph while this device was offline and had unsent text inside it, that text
   * disappears on merge. That must not be silent: emit the pre-merge state so it can be saved.
   */
  #guardUnsyncedContent = (transaction) => {
    const guard = this.recoveryGuard;
    if (!guard || guard.triggered || transaction.origin !== REMOTE) return;
    let lost = false;
    transaction.deleteSet.clients.forEach((ranges, client) => {
      const known = guard.known.get(client) ?? 0;
      if (ranges.some((range) => range.clock + range.len > known)) lost = true;
    });
    if (lost) {
      guard.triggered = true;
      queueMicrotask(() => this.emit('recovery', { docId: this.docId, state: guard.preState }));
    }
  };

  #onAck(ackId) {
    const entry = this.acks.get(ackId);
    if (!entry) return;
    for (const id of this.acks.keys()) if (id <= ackId) this.acks.delete(id);
    if (this.recoveryGuard && this.recoveryGuard.ackId !== null && ackId >= this.recoveryGuard.ackId) this.recoveryGuard = null;
    const now = Date.now();
    const patch = { lastAckLatencyMs: now - entry.sentAt, lastServerContactAt: now };
    if (entry.coversUpTo > this.state.durableVersion) {
      patch.durableVersion = entry.coversUpTo;
      this.storage?.setDurable(this.docId, entry.coversUpTo).catch(() => {});
    }
    this.#set(patch);
    this.#publishUnsynced();
  }

  #onControl(control) {
    if (!control || typeof control !== 'object') return;
    if (control.kind === 'hello') {
      this.#set({ role: control.role, readOnlyRejected: false });
    } else if (control.kind === 'role') {
      const couldEdit = this.canEdit;
      this.#set({ role: control.role, readOnlyRejected: false });
      this.emit('role', control.role);
      // Changes held back while read-only can be sent now; a fresh handshake resends them all.
      if (!couldEdit && this.canEdit && this.pendingCount > 0) this.reconnect();
    } else if (control.kind === 'error') {
      if (control.code === 'read_only') this.#set({ readOnlyRejected: true });
      this.emit('server-error', control);
    } else if (control.kind === 'restored') {
      this.emit('restored', control);
    }
  }

  #onClose(code, reason) {
    clearInterval(this.timers.heartbeat);
    clearTimeout(this.timers.flush);
    this.timers.flush = null;
    this.socket = null;
    this.generation += 1;
    this.step2Sent = false;
    this.acks.clear();
    this.outgoing = [];
    this.recoveryGuard = null;
    // Other people's presence is only meaningful while connected.
    const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID);
    if (others.length > 0) awarenessProtocol.removeAwarenessStates(this.awareness, others, 'connection-lost');
    if (this.destroyed) return;
    if (TERMINAL_CLOSE_CODES.has(code)) {
      this.#set({ connection: 'blocked', serverSynced: false, blocked: { code, reason: reason || null }, retryAt: null });
      return;
    }
    this.#set({ serverSynced: false });
    this.#scheduleReconnect();
  }

  #scheduleReconnect() {
    if (this.destroyed || this.state.blocked) return;
    if (this.network && !this.network.isOnline()) {
      this.#set({ connection: 'offline', retryAt: null });
      return;
    }
    const base = Math.min(this.options.maxBackoffMs, this.options.minBackoffMs * 2 ** this.attempt);
    const delay = Math.round(base * (0.5 + Math.random() * 0.5));
    this.attempt += 1;
    this.#set({ connection: 'waiting', retryAt: Date.now() + delay, reconnects: this.state.reconnects + 1 });
    this.timers.retry = setTimeout(() => {
      this.timers.retry = null;
      this.#connect();
    }, delay);
  }

  #onOnline() {
    if (this.socket || this.state.blocked || this.destroyed) return;
    this.attempt = 0;
    this.#connect();
  }

  #onOffline() {
    if (this.destroyed) return;
    clearTimeout(this.timers.retry);
    this.timers.retry = null;
    if (this.socket) {
      this.#dropSocket(1000, 'offline');
      this.#onClose(1006, 'offline');
    } else {
      this.#set({ connection: 'offline', retryAt: null });
    }
  }

  #dropSocket(code, reason) {
    const socket = this.socket;
    if (!socket) return;
    this.socket = null;
    this.generation += 1;
    socket.onopen = socket.onmessage = socket.onclose = null;
    try {
      socket.close(code, reason);
    } catch {
      // Already closing.
    }
  }

  #send(bytes) {
    if (this.socket?.readyState === OPEN) this.socket.send(bytes);
  }

  // ---- Presence --------------------------------------------------------------------------

  #onAwarenessUpdate = ({ added, updated, removed }, origin) => {
    if (origin === REMOTE || origin === 'connection-lost') return;
    const changed = [...added, ...updated, ...removed];
    if (changed.length > 0 && this.socket?.readyState === OPEN) {
      this.#send(encodeAwareness(awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed)));
    }
  };

  #publishUnsynced() {
    const local = this.awareness.getLocalState();
    if (!local) return;
    const unsynced = this.pendingCount > 0;
    if (local.unsynced !== unsynced) this.awareness.setLocalStateField('unsynced', unsynced);
  }

  #set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('change', this.state);
  }
}

function describeError(error) {
  const name = error?.name ?? 'Error';
  if (name === 'QuotaExceededError') return { code: 'quota', message: 'This device is out of storage space for offline copies.' };
  return { code: 'storage', message: error?.message ?? 'Local storage failed.' };
}
