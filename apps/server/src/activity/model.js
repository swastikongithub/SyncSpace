import mongoose from 'mongoose';

const { ObjectId } = mongoose.Schema.Types;

export const ACTIVITY_TYPES = Object.freeze([
  'workspace.created',
  'workspace.renamed',
  'member.invited',
  'member.joined',
  'member.role_changed',
  'member.removed',
  'member.left',
  'document.created',
  'document.edited',
  'document.renamed',
  'document.trashed',
  'document.untrashed',
  'document.purged',
  'version.saved',
  'version.restored',
  'version.recovered',
]);

const activitySchema = new mongoose.Schema({
  workspaceId: { type: ObjectId, ref: 'Workspace', required: true },
  actorId: { type: ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ACTIVITY_TYPES, required: true },
  documentId: { type: ObjectId, ref: 'Document' },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, required: true, default: () => new Date() },
});
activitySchema.index({ workspaceId: 1, createdAt: -1 });
activitySchema.index({ workspaceId: 1, documentId: 1, actorId: 1, type: 1, createdAt: -1 });

export const Activity = mongoose.model('Activity', activitySchema);
