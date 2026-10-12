import mongoose from 'mongoose';
import { LIMITS, PLY_KEYS } from '@syncspace/shared';

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: LIMITS.emailMax },
    name: { type: String, required: true, trim: true, maxlength: LIMITS.userNameMax },
    passwordHash: { type: String, required: true, select: false },
    ply: { type: String, required: true, enum: PLY_KEYS },
  },
  { timestamps: true },
);

export const User = mongoose.model('User', userSchema);

export function publicUser(user) {
  return { id: String(user._id), email: user.email, name: user.name, ply: user.ply };
}

/** The identity other collaborators may see (no email). */
export function collaboratorIdentity(user) {
  return { id: String(user._id), name: user.name, ply: user.ply };
}
