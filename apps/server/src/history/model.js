import mongoose from 'mongoose';
import { LIMITS } from '@syncspace/shared';

const { ObjectId } = mongoose.Schema.Types;

export const VERSION_KINDS = Object.freeze(['auto', 'manual', 'pre-restore', 'restore', 'recovered']);

// A full, self-contained copy of a document's Yjs state at a moment in time. Versions are kept
// separately from the update log so compaction never affects history.
const docVersionSchema = new mongoose.Schema({
  docId: { type: ObjectId, ref: 'Document', required: true },
  workspaceId: { type: ObjectId, ref: 'Workspace', required: true },
  kind: { type: String, enum: VERSION_KINDS, required: true },
  label: { type: String, maxlength: LIMITS.versionLabelMax, default: '' },
  state: { type: Buffer, required: true, select: false },
  sizeBytes: { type: Number, required: true },
  title: { type: String, default: '' },
  excerpt: { type: String, default: '' },
  wordCount: { type: Number, default: 0 },
  createdBy: { type: ObjectId, ref: 'User' },
  contributors: [{ type: ObjectId, ref: 'User' }],
  restoredFrom: { type: ObjectId, ref: 'DocVersion' },
  createdAt: { type: Date, required: true, default: () => new Date() },
});
docVersionSchema.index({ docId: 1, createdAt: -1 });
docVersionSchema.index({ docId: 1, kind: 1, createdAt: -1 });

export const DocVersion = mongoose.model('DocVersion', docVersionSchema);
