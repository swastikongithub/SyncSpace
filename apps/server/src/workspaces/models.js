import mongoose from 'mongoose';
import { INVITABLE_ROLES, LIMITS, ROLES } from '@syncspace/shared';

const { ObjectId } = mongoose.Schema.Types;

const workspaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: LIMITS.workspaceNameMax },
    createdBy: { type: ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
export const Workspace = mongoose.model('Workspace', workspaceSchema);

const membershipSchema = new mongoose.Schema(
  {
    workspaceId: { type: ObjectId, ref: 'Workspace', required: true },
    userId: { type: ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ROLES, required: true },
    invitedBy: { type: ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
membershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ userId: 1 });
export const Membership = mongoose.model('Membership', membershipSchema);

const invitationSchema = new mongoose.Schema(
  {
    workspaceId: { type: ObjectId, ref: 'Workspace', required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: LIMITS.emailMax },
    role: { type: String, enum: INVITABLE_ROLES, required: true },
    tokenHash: { type: String, required: true, unique: true },
    createdBy: { type: ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: Date,
    acceptedBy: { type: ObjectId, ref: 'User' },
    revokedAt: Date,
  },
  { timestamps: true },
);
export const Invitation = mongoose.model('Invitation', invitationSchema);
