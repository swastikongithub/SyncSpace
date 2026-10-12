import { WebSocket } from 'ws';
import { can } from '@syncspace/shared';
import { encodeAck, encodeControl } from '@syncspace/shared/protocol';
import { collaboratorIdentity } from '../users/model.js';

const MAX_BUFFERED_BYTES = 16 * 1024 * 1024;
const RATE_CAPACITY = 300;
const RATE_REFILL_PER_SEC = 150;

/** One authenticated WebSocket bound to one document. */
export class Connection {
  constructor(ws, { user, session, role, workspaceId, docId }) {
    this.ws = ws;
    this.user = user;
    this.userId = String(user._id);
    this.sessionId = String(session._id);
    this.workspaceId = String(workspaceId);
    this.docId = docId;
    this.role = role;
    this.identity = collaboratorIdentity(user);
    this.awarenessClientIds = new Set();
    this.room = null;
    this.alive = true;
    this.tokens = RATE_CAPACITY;
    this.refilledAt = Date.now();
    this.readOnlyNotified = false;
  }

  get canEdit() {
    return can(this.role, 'doc.edit');
  }

  get isOpen() {
    return this.ws.readyState === WebSocket.OPEN;
  }

  /** Token bucket: returns false when the client sends faster than any editor plausibly would. */
  takeToken() {
    const now = Date.now();
    this.tokens = Math.min(RATE_CAPACITY, this.tokens + ((now - this.refilledAt) / 1000) * RATE_REFILL_PER_SEC);
    this.refilledAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  send(bytes) {
    if (!this.isOpen) return;
    // A client that stops reading must not make the server buffer without bound.
    if (this.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.ws.terminate();
      return;
    }
    this.ws.send(bytes);
  }

  sendControl(message) {
    this.send(encodeControl(message));
  }

  sendAck(ackId) {
    this.send(encodeAck(ackId));
  }

  setRole(role) {
    if (role === this.role) return;
    this.role = role;
    this.readOnlyNotified = false;
    this.sendControl({ kind: 'role', role });
  }

  close(code, reason) {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close(code, reason);
    }
  }
}
