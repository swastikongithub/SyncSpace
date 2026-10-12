import { WebSocketServer } from 'ws';
import { LIMITS } from '@syncspace/shared';
import { CloseCode, decodeMessage, encodeControl, ProtocolError } from '@syncspace/shared/protocol';
import { HttpError } from '../http/errors.js';
import { isAllowedOrigin } from '../http/security.js';
import { authorizeDocument } from '../workspaces/access.js';
import { Membership } from '../workspaces/models.js';
import { Connection } from './connection.js';
import { DocRoom, ServerChange } from './room.js';

const PATH = /^\/ws\/documents\/([a-f0-9]{24})$/i;

export const DEFAULT_COLLAB_SETTINGS = Object.freeze({
  unloadDelayMs: 30_000,
  compactAfterUpdates: 200,
  derivedDelayMs: 1_500,
  autoVersionIntervalMs: 10 * 60_000,
  heartbeatIntervalMs: 30_000,
  revalidateIntervalMs: 60_000,
});

function rejectUpgrade(socket, status, text) {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

/**
 * Real-time collaboration over WebSockets: one socket per open document, authorised with the
 * same session cookie and access rules as the HTTP API.
 */
export function createCollabService({ config, logger, authenticate, sessions, metrics, store, hooks, settings: overrides }) {
  const settings = { ...DEFAULT_COLLAB_SETTINGS, ...overrides };
  const log = logger.child({ component: 'collab' });
  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.wsMessageMaxBytes, perMessageDeflate: false });
  const rooms = new Map(); // docId -> { room } | { loading } | { unloading }
  const connections = new Set();
  let shuttingDown = false;

  // ---- Rooms ---------------------------------------------------------------------------

  function onRoomClosed(room, reason) {
    if (reason === 'idle') {
      void unloadRoom(room);
      return;
    }
    const entry = rooms.get(room.docId);
    if (entry?.room === room && !entry.unloading) rooms.delete(room.docId);
  }

  async function unloadRoom(room) {
    const entry = rooms.get(room.docId);
    if (entry?.room !== room || entry.unloading || room.conns.size > 0 || room.leases > 0) return;
    const unloading = room.drainAndClose().finally(() => {
      if (rooms.get(room.docId)?.room === room) rooms.delete(room.docId);
    });
    rooms.set(room.docId, { room, unloading });
    await unloading;
  }

  async function acquireRoom(docId, workspaceId) {
    let entry = rooms.get(docId);
    if (entry?.unloading) {
      await entry.unloading;
      entry = rooms.get(docId);
    }
    if (entry?.room && !entry.room.closed) return entry.room;
    if (entry?.loading) return entry.loading;
    const loading = (async () => {
      const loaded = await store.load(docId);
      return new DocRoom({ docId, workspaceId, ...loaded, store, hooks, metrics, logger: log, settings, onClosed: onRoomClosed });
    })();
    rooms.set(docId, { loading });
    try {
      const room = await loading;
      rooms.set(docId, { room });
      return room;
    } catch (error) {
      rooms.delete(docId);
      throw error;
    }
  }

  function liveRoom(docId) {
    const entry = rooms.get(docId);
    return entry?.room && !entry.room.closed && !entry.unloading ? entry.room : null;
  }

  /**
   * Holds the document's room loaded while `fn(room)` runs, so multi-step server operations
   * (rename, snapshot, restore) cannot race an idle unload.
   */
  async function withRoom(docId, workspaceId, fn) {
    const room = await acquireRoom(docId, workspaceId);
    room.leases += 1;
    try {
      return await fn(room);
    } finally {
      room.leases -= 1;
      if (room.conns.size === 0 && room.leases === 0) void unloadRoom(room);
    }
  }

  /** Applies a server-originated change and resolves once it is durably stored. */
  function applyServerChange(docId, workspaceId, change, { userId, reason }) {
    return withRoom(docId, workspaceId, (room) => room.applyServerChange(change, new ServerChange({ userId, reason })));
  }

  // ---- Connections ---------------------------------------------------------------------

  function handleUpgrade(req, socket, head) {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const match = PATH.exec(path);
    if (!match || shuttingDown) {
      rejectUpgrade(socket, shuttingDown ? 503 : 404, shuttingDown ? 'Service Unavailable' : 'Not Found');
      return;
    }
    // Browsers attach cookies to cross-site WebSocket handshakes; the Origin check stops
    // other sites from opening sockets with a visitor's session (cross-site WebSocket hijacking).
    if (!isAllowedOrigin(req.headers.origin, config.allowedOrigins)) {
      metrics.inc('wsRejectedOrigin');
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      onConnection(ws, req, match[1].toLowerCase()).catch((error) => {
        log.error({ err: error }, 'WebSocket setup failed');
        ws.close(1011, 'server_error');
      });
    });
  }

  function closeWith(ws, code, reason, message) {
    ws.send(encodeControl({ kind: 'error', code: reason, message }));
    ws.close(code, reason);
  }

  async function onConnection(ws, req, docId) {
    metrics.inc('wsConnectionsOpened');
    const pending = [];
    let conn = null;

    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        ws.close(CloseCode.InvalidMessage, 'binary_only');
        return;
      }
      if (conn) process(conn, data);
      else pending.push(data);
    });
    ws.on('close', () => {
      if (!conn) return;
      connections.delete(conn);
      conn.room?.removeConnection(conn);
    });
    ws.on('error', (error) => log.warn({ err: { message: error.message } }, 'WebSocket error'));
    ws.on('pong', () => {
      if (conn) conn.alive = true;
    });

    const { auth, hadToken } = await authenticate(req.headers);
    if (!auth) {
      metrics.inc('wsAuthFailures');
      closeWith(
        ws,
        CloseCode.Unauthenticated,
        hadToken ? 'session_expired' : 'unauthenticated',
        hadToken ? 'Your session has ended. Sign in again to keep syncing.' : 'Sign in to open this document.',
      );
      return;
    }

    let access;
    try {
      access = await authorizeDocument(auth.user, docId, 'doc.read');
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      metrics.inc('wsAccessDenied');
      const code = error.code === 'document_trashed' ? CloseCode.DocumentGone : CloseCode.NotFound;
      closeWith(ws, code, error.code, error.message);
      return;
    }
    if (ws.readyState !== ws.OPEN) return;

    const candidate = new Connection(ws, {
      user: auth.user,
      session: auth.session,
      role: access.role,
      workspaceId: access.document.workspaceId,
      docId,
    });
    const room = await acquireRoom(docId, access.document.workspaceId);
    if (ws.readyState !== ws.OPEN) {
      if (room.conns.size === 0) void unloadRoom(room);
      return;
    }
    room.addConnection(candidate);
    connections.add(candidate);
    conn = candidate;
    for (const data of pending.splice(0)) process(conn, data);
  }

  function process(conn, data) {
    if (!conn.room || conn.room.closed) return;
    metrics.inc('messagesIn');
    if (!conn.takeToken()) {
      metrics.inc('rateLimited');
      conn.close(CloseCode.RateLimited, 'rate_limited');
      return;
    }
    try {
      conn.room.handleMessage(conn, decodeMessage(data));
    } catch (error) {
      metrics.inc('protocolErrors');
      const level = error instanceof ProtocolError ? 'info' : 'warn';
      log[level]({ err: { name: error.name, message: error.message }, userId: conn.userId }, 'Rejected client message');
      conn.close(CloseCode.InvalidMessage, 'invalid_message');
    }
  }

  // ---- Liveness and revalidation -----------------------------------------------------------

  const heartbeat = setInterval(() => {
    for (const conn of connections) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      conn.ws.ping();
    }
  }, settings.heartbeatIntervalMs);
  heartbeat.unref();

  /**
   * Long-lived sockets outlive the checks made when they opened. Periodically re-check that each
   * session is still valid and each membership still exists, and apply role changes.
   */
  async function revalidate() {
    const bySession = groupBy(connections, (conn) => conn.sessionId);
    for (const [sessionId, conns] of bySession) {
      if (!(await sessions.isLive(sessionId))) {
        for (const conn of conns) closeWithConn(conn, CloseCode.Unauthenticated, 'session_expired', 'Your session has ended. Sign in again to keep syncing.');
      }
    }
    const byMember = groupBy(connections, (conn) => `${conn.workspaceId}:${conn.userId}`);
    for (const conns of byMember.values()) {
      const [{ workspaceId, userId }] = conns;
      const membership = await Membership.findOne({ workspaceId, userId }, { role: 1 }).lean();
      for (const conn of conns) {
        if (!membership) closeWithConn(conn, CloseCode.AccessRevoked, 'access_revoked', 'You no longer have access to this workspace.');
        else conn.setRole(membership.role);
      }
    }
  }
  const revalidation = setInterval(() => {
    revalidate().catch((error) => log.warn({ err: { message: error.message } }, 'Revalidation failed'));
  }, settings.revalidateIntervalMs);
  revalidation.unref();

  function closeWithConn(conn, code, reason, message) {
    conn.sendControl({ kind: 'error', code: reason, message });
    conn.close(code, reason);
  }

  // ---- Hooks for the HTTP API ----------------------------------------------------------------

  function closeSession(sessionId) {
    for (const conn of connections) {
      if (conn.sessionId === sessionId) closeWithConn(conn, CloseCode.Unauthenticated, 'signed_out', 'You signed out.');
    }
  }

  function revokeMember(workspaceId, userId) {
    for (const conn of connections) {
      if (conn.workspaceId === workspaceId && conn.userId === userId) {
        closeWithConn(conn, CloseCode.AccessRevoked, 'access_revoked', 'You no longer have access to this workspace.');
      }
    }
  }

  function updateMemberRole(workspaceId, userId, role) {
    for (const conn of connections) {
      if (conn.workspaceId === workspaceId && conn.userId === userId) conn.setRole(role);
    }
  }

  async function closeDocument(docId, { code, reason, message, discard = false }) {
    const entry = rooms.get(docId);
    const room = entry?.room ?? (entry?.loading ? await entry.loading.catch(() => null) : null);
    if (!room || room.closed) return;
    room.closeAll(code, reason, { kind: 'error', code: reason, message });
    if (discard) room.destroy();
  }

  function broadcastControl(docId, control) {
    liveRoom(docId)?.broadcast(encodeControl(control));
  }

  async function shutdown({ graceful = true } = {}) {
    shuttingDown = true;
    clearInterval(heartbeat);
    clearInterval(revalidation);
    const live = [...rooms.values()].map((entry) => entry.room).filter(Boolean);
    for (const conn of connections) {
      if (graceful) conn.close(CloseCode.ServerRestart, 'server_restart');
      else conn.ws.terminate();
    }
    if (graceful) await Promise.all(live.map((room) => room.drainAndClose()));
    else for (const room of live) room.destroy();
    rooms.clear();
    connections.clear();
    await new Promise((resolve) => wss.close(() => resolve()));
  }

  function stats() {
    const live = [...rooms.values()].map((entry) => entry.room).filter((room) => room && !room.closed);
    return {
      activeConnections: connections.size,
      activeRooms: live.length,
      queuedWrites: live.reduce((sum, room) => sum + room.queue.length, 0),
    };
  }

  return {
    handleUpgrade,
    applyServerChange,
    withRoom,
    liveRoom,
    closeSession,
    revokeMember,
    updateMemberRole,
    closeDocument,
    broadcastControl,
    revalidate,
    shutdown,
    stats,
    settings,
  };
}

function groupBy(items, key) {
  const groups = new Map();
  for (const item of items) {
    const value = key(item);
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(item);
  }
  return groups;
}
