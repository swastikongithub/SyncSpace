import mongoose from 'mongoose';
import { LIMITS } from '@syncspace/shared';

const { ObjectId } = mongoose.Schema.Types;

// Document metadata. The content itself lives in the collaboration store as Yjs updates;
// title, excerpt and contentText are derived from it for listing and search.
const documentSchema = new mongoose.Schema(
  {
    workspaceId: { type: ObjectId, ref: 'Workspace', required: true },
    title: { type: String, default: '', maxlength: LIMITS.documentTitleMax },
    excerpt: { type: String, default: '' },
    contentText: { type: String, default: '', select: false },
    wordCount: { type: Number, default: 0 },
    pinned: { type: Boolean, default: false },
    createdBy: { type: ObjectId, ref: 'User', required: true },
    lastEditedBy: { type: ObjectId, ref: 'User' },
    lastEditedAt: { type: Date, default: () => new Date() },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
documentSchema.index({ workspaceId: 1, deletedAt: 1, lastEditedAt: -1 });

export const Document = mongoose.model('Document', documentSchema);

export function documentSummary(document, people = new Map()) {
  const person = (id) => (id ? (people.get(String(id)) ?? null) : null);
  return {
    id: String(document._id),
    workspaceId: String(document.workspaceId),
    title: document.title,
    excerpt: document.excerpt,
    wordCount: document.wordCount,
    pinned: Boolean(document.pinned),
    createdBy: person(document.createdBy),
    lastEditedBy: person(document.lastEditedBy),
    lastEditedAt: document.lastEditedAt,
    createdAt: document.createdAt,
    deletedAt: document.deletedAt,
  };
}
