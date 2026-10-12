import * as Y from 'yjs';
import { DocCheckpoint, DocUpdate } from './models.js';

export const LOAD_ORIGIN = Symbol('load');

/** Accepts a Buffer, Uint8Array or BSON Binary (from lean queries) and returns a Uint8Array. */
export function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value?._bsontype === 'Binary') return value.read(0, value.length());
  throw new TypeError('Expected binary data');
}

const toBuffer = (bytes) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Durable storage for collaborative document state: an append-only update log plus a checkpoint. */
export function createDocStore() {
  return {
    async load(docId) {
      // Reading the checkpoint and then the updates after it is not atomic. If a compaction lands
      // in between, the updates it folded into a newer checkpoint are already deleted; detect that
      // by re-reading the checkpoint and retry, so a room never starts from a partial state.
      let checkpoint;
      let updates;
      for (let attempt = 0; ; attempt += 1) {
        checkpoint = await DocCheckpoint.findOne({ docId }).lean();
        updates = await DocUpdate.find({ docId, seq: { $gt: checkpoint?.seq ?? 0 } }, { seq: 1, update: 1 })
          .sort({ seq: 1 })
          .lean();
        const recheck = await DocCheckpoint.findOne({ docId }, { seq: 1 }).lean();
        if ((recheck?.seq ?? 0) === (checkpoint?.seq ?? 0)) break;
        if (attempt >= 5) throw new Error(`Document ${docId} kept changing while loading`);
      }
      const checkpointSeq = checkpoint?.seq ?? 0;
      const ydoc = new Y.Doc();
      ydoc.transact(() => {
        if (checkpoint) Y.applyUpdate(ydoc, toBytes(checkpoint.state), LOAD_ORIGIN);
        for (const entry of updates) Y.applyUpdate(ydoc, toBytes(entry.update), LOAD_ORIGIN);
      }, LOAD_ORIGIN);
      const lastSeq = updates.length > 0 ? updates.at(-1).seq : checkpointSeq;
      return { ydoc, lastSeq, uncheckpointed: updates.length };
    },

    /** Appends updates in order. Throws (and writes nothing further) if any seq is already taken. */
    async append(docId, entries) {
      await DocUpdate.insertMany(
        entries.map((entry) => ({ docId, seq: entry.seq, update: toBuffer(entry.update), userId: entry.userId ?? undefined })),
        { ordered: true },
      );
    },

    /**
     * Replaces the log prefix up to `seq` with one compacted state. The checkpoint is written
     * before the old updates are deleted, so a crash in between only leaves redundant updates,
     * which are idempotent when replayed.
     */
    async checkpoint(docId, state, seq) {
      try {
        await DocCheckpoint.updateOne(
          { docId, seq: { $lt: seq } },
          { $set: { state: toBuffer(state), seq, updatedAt: new Date() } },
          { upsert: true },
        );
      } catch (error) {
        // A newer checkpoint already exists (the filter missed and the upsert hit the unique key).
        if (error?.code !== 11000) throw error;
      }
      await DocUpdate.deleteMany({ docId, seq: { $lte: seq } });
    },

    async initialize(docId, state, userId) {
      await DocUpdate.create({ docId, seq: 1, update: toBuffer(state), userId });
    },

    async purge(docIds) {
      await Promise.all([DocUpdate.deleteMany({ docId: { $in: docIds } }), DocCheckpoint.deleteMany({ docId: { $in: docIds } })]);
    },

    async stats(docId) {
      const [updates, checkpoint] = await Promise.all([
        DocUpdate.countDocuments({ docId }),
        DocCheckpoint.findOne({ docId }, { seq: 1, state: 1 }).lean(),
      ]);
      return { updates, checkpointSeq: checkpoint?.seq ?? 0, checkpointBytes: checkpoint ? toBytes(checkpoint.state).byteLength : 0 };
    },
  };
}
