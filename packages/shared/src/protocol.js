// SyncSpace collaboration wire protocol.
//
// Every frame starts with a varUint message type. Document payloads are standard Yjs updates
// and state vectors; awareness payloads use y-protocols' awareness encoding.
//
// The protocol extends the usual Yjs sync exchange with durability acknowledgements:
// a client attaches a non-zero `ackId` to SyncStep2/Update/Checkpoint frames, and the server
// replies with Ack(ackId) only after everything up to that frame is written to MongoDB.
// Clients therefore never have to guess whether a change is stored on the server.
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

export const MessageType = Object.freeze({
  /** payload: state vector. "Send me what I am missing." */
  SyncStep1: 0,
  /** payload: ackId, update. Reply to SyncStep1. */
  SyncStep2: 1,
  /** payload: ackId, update. Incremental change. */
  Update: 2,
  /** payload: y-protocols awareness update. Ephemeral presence; never persisted. */
  Awareness: 3,
  /** server → client. payload: ackId. Everything up to that frame is durable. */
  Ack: 4,
  /** client → server. payload: ackId. Ask for an Ack once preceding writes are durable. */
  Checkpoint: 5,
  /** server → client. payload: JSON control message (hello, errors, role changes, restores). */
  Control: 6,
  /** either direction, no payload. Keeps idle connections observable. */
  Heartbeat: 7,
});

/** Application close codes (4000–4999 are reserved for applications by RFC 6455). */
export const CloseCode = Object.freeze({
  Normal: 1000,
  GoingAway: 1001,
  TooLarge: 1009,
  ServerRestart: 1012,
  InvalidMessage: 4400,
  Unauthenticated: 4401,
  AccessRevoked: 4403,
  NotFound: 4404,
  DocumentGone: 4410,
  RateLimited: 4429,
  PersistenceFailure: 4500,
});

/** Close codes after which reconnecting cannot succeed without user action. */
export const TERMINAL_CLOSE_CODES = Object.freeze(
  new Set([CloseCode.Unauthenticated, CloseCode.AccessRevoked, CloseCode.NotFound, CloseCode.DocumentGone]),
);

export class ProtocolError extends Error {}

const withAck = new Set([MessageType.SyncStep2, MessageType.Update]);

export function encodeSyncStep1(stateVector) {
  return frame(MessageType.SyncStep1, (encoder) => encoding.writeVarUint8Array(encoder, stateVector));
}

export function encodeSyncStep2(update, ackId = 0) {
  return frame(MessageType.SyncStep2, (encoder) => {
    encoding.writeVarUint(encoder, ackId);
    encoding.writeVarUint8Array(encoder, update);
  });
}

export function encodeUpdate(update, ackId = 0) {
  return frame(MessageType.Update, (encoder) => {
    encoding.writeVarUint(encoder, ackId);
    encoding.writeVarUint8Array(encoder, update);
  });
}

export function encodeAwareness(awarenessUpdate) {
  return frame(MessageType.Awareness, (encoder) => encoding.writeVarUint8Array(encoder, awarenessUpdate));
}

export function encodeAck(ackId) {
  return frame(MessageType.Ack, (encoder) => encoding.writeVarUint(encoder, ackId));
}

export function encodeCheckpoint(ackId) {
  return frame(MessageType.Checkpoint, (encoder) => encoding.writeVarUint(encoder, ackId));
}

export function encodeControl(message) {
  return frame(MessageType.Control, (encoder) => encoding.writeVarString(encoder, JSON.stringify(message)));
}

export function encodeHeartbeat() {
  return frame(MessageType.Heartbeat, () => {});
}

/**
 * Decodes one frame. Throws ProtocolError for anything malformed, including trailing bytes,
 * so a peer cannot smuggle extra data past validation.
 */
export function decodeMessage(data) {
  const bytes = toUint8Array(data);
  try {
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    let message;
    if (type === MessageType.SyncStep1) {
      message = { type, stateVector: decoding.readVarUint8Array(decoder) };
    } else if (withAck.has(type)) {
      const ackId = decoding.readVarUint(decoder);
      message = { type, ackId, update: decoding.readVarUint8Array(decoder) };
    } else if (type === MessageType.Awareness) {
      message = { type, update: decoding.readVarUint8Array(decoder) };
    } else if (type === MessageType.Ack || type === MessageType.Checkpoint) {
      message = { type, ackId: decoding.readVarUint(decoder) };
    } else if (type === MessageType.Control) {
      message = { type, control: JSON.parse(decoding.readVarString(decoder)) };
    } else if (type === MessageType.Heartbeat) {
      message = { type };
    } else {
      throw new ProtocolError(`Unknown message type ${type}`);
    }
    if (decoding.hasContent(decoder)) throw new ProtocolError('Trailing bytes after message');
    return message;
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError(`Malformed message: ${error.message}`);
  }
}

function frame(type, write) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

function toUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new ProtocolError('Unsupported frame data');
}
