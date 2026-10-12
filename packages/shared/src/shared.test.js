import { describe, expect, it } from 'vitest';
import {
  can,
  CloseCode,
  decodeMessage,
  encodeAck,
  encodeAwareness,
  encodeCheckpoint,
  encodeControl,
  encodeHeartbeat,
  encodeSyncStep1,
  encodeSyncStep2,
  encodeUpdate,
  MessageType,
  PLY_KEYS,
  plyForSeed,
  ProtocolError,
  roleAtLeast,
  TERMINAL_CLOSE_CODES,
} from './index.js';

describe('protocol', () => {
  const bytes = new Uint8Array([1, 2, 3, 250]);

  it('round-trips every message type', () => {
    expect(decodeMessage(encodeSyncStep1(bytes))).toEqual({ type: MessageType.SyncStep1, stateVector: bytes });
    expect(decodeMessage(encodeSyncStep2(bytes, 7))).toEqual({ type: MessageType.SyncStep2, ackId: 7, update: bytes });
    expect(decodeMessage(encodeUpdate(bytes, 300))).toEqual({ type: MessageType.Update, ackId: 300, update: bytes });
    expect(decodeMessage(encodeUpdate(bytes))).toEqual({ type: MessageType.Update, ackId: 0, update: bytes });
    expect(decodeMessage(encodeAwareness(bytes))).toEqual({ type: MessageType.Awareness, update: bytes });
    expect(decodeMessage(encodeAck(42))).toEqual({ type: MessageType.Ack, ackId: 42 });
    expect(decodeMessage(encodeCheckpoint(9))).toEqual({ type: MessageType.Checkpoint, ackId: 9 });
    expect(decodeMessage(encodeControl({ kind: 'hello', role: 'editor' }))).toEqual({
      type: MessageType.Control,
      control: { kind: 'hello', role: 'editor' },
    });
    expect(decodeMessage(encodeHeartbeat())).toEqual({ type: MessageType.Heartbeat });
  });

  it('accepts ArrayBuffer input as delivered by browsers', () => {
    const frame = encodeAck(5);
    expect(decodeMessage(frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength))).toEqual({ type: MessageType.Ack, ackId: 5 });
  });

  it('rejects unknown types, truncated frames and trailing bytes', () => {
    expect(() => decodeMessage(new Uint8Array([99]))).toThrow(ProtocolError);
    expect(() => decodeMessage(new Uint8Array([MessageType.Update, 1, 10, 1]))).toThrow(ProtocolError);
    expect(() => decodeMessage(new Uint8Array([...encodeAck(1), 0]))).toThrow(/Trailing bytes/);
    expect(() => decodeMessage(new Uint8Array([]))).toThrow(ProtocolError);
    expect(() => decodeMessage('text')).toThrow(ProtocolError);
  });

  it('treats only unrecoverable closes as terminal', () => {
    expect(TERMINAL_CLOSE_CODES.has(CloseCode.Unauthenticated)).toBe(true);
    expect(TERMINAL_CLOSE_CODES.has(CloseCode.NotFound)).toBe(true);
    expect(TERMINAL_CLOSE_CODES.has(CloseCode.PersistenceFailure)).toBe(false);
    expect(TERMINAL_CLOSE_CODES.has(CloseCode.ServerRestart)).toBe(false);
  });
});

describe('roles', () => {
  it('orders roles owner > editor > viewer', () => {
    expect(roleAtLeast('owner', 'editor')).toBe(true);
    expect(roleAtLeast('editor', 'owner')).toBe(false);
    expect(roleAtLeast('viewer', 'viewer')).toBe(true);
    expect(roleAtLeast('admin', 'viewer')).toBe(false);
    expect(roleAtLeast(undefined, 'viewer')).toBe(false);
  });

  it('grants permissions by minimum role', () => {
    expect(can('viewer', 'doc.read')).toBe(true);
    expect(can('viewer', 'doc.edit')).toBe(false);
    expect(can('editor', 'history.restore')).toBe(true);
    expect(can('editor', 'members.manage')).toBe(false);
    expect(can('owner', 'doc.purge')).toBe(true);
    expect(() => can('owner', 'made.up')).toThrow(/Unknown permission/);
  });
});

describe('plies', () => {
  it('assigns a stable ply from the palette', () => {
    expect(PLY_KEYS).toContain(plyForSeed('64f0c2'));
    expect(plyForSeed('abc')).toBe(plyForSeed('abc'));
  });
});
