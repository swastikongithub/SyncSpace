import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

// Append-only log of effective Yjs updates. Each update is its own small record, so no single
// MongoDB document grows without bound. `seq` orders updates within a document.
const docUpdateSchema = new mongoose.Schema({
  docId: { type: ObjectId, ref: 'Document', required: true },
  seq: { type: Number, required: true },
  update: { type: Buffer, required: true },
  userId: { type: ObjectId, ref: 'User' },
  createdAt: { type: Date, required: true, default: () => new Date() },
});
// Unique (docId, seq): two writers can never both claim the same position in the log.
docUpdateSchema.index({ docId: 1, seq: 1 }, { unique: true });
export const DocUpdate = mongoose.model('DocUpdate', docUpdateSchema);

// Compacted state covering every update with seq <= `seq`. Updates at or below it are deleted
// after the checkpoint is written; loading = checkpoint + updates with seq > checkpoint.seq.
const docCheckpointSchema = new mongoose.Schema({
  docId: { type: ObjectId, ref: 'Document', required: true, unique: true },
  seq: { type: Number, required: true },
  state: { type: Buffer, required: true },
  updatedAt: { type: Date, required: true, default: () => new Date() },
});
export const DocCheckpoint = mongoose.model('DocCheckpoint', docCheckpointSchema);
