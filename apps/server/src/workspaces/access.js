// The one place that decides who may do what. HTTP routes and WebSocket upgrades both call
// these functions, so the rules cannot drift between transports.
import mongoose from 'mongoose';
import { can } from '@syncspace/shared';
import { forbidden, notFound } from '../http/errors.js';
import { Document } from '../documents/model.js';
import { Membership, Workspace } from './models.js';

const isObjectId = (value) => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);

const workspaceNotFound = () => notFound('workspace_not_found', 'This workspace does not exist or you are not a member.');
const documentNotFound = () => notFound('document_not_found', 'This document does not exist or you do not have access to it.');

function insufficientRole(permission) {
  return forbidden('insufficient_role', `Your role in this workspace does not allow this action (${permission}).`);
}

export async function findMembership(userId, workspaceId) {
  if (!isObjectId(String(workspaceId))) return null;
  return Membership.findOne({ userId, workspaceId }).lean();
}

/**
 * Resolves a workspace the user belongs to and checks the permission.
 * Non-members get the same 404 as a missing workspace, so IDs cannot be probed.
 */
export async function authorizeWorkspace(user, workspaceId, permission) {
  const membership = await findMembership(user._id, workspaceId);
  if (!membership) throw workspaceNotFound();
  const workspace = await Workspace.findById(workspaceId).lean();
  if (!workspace) throw workspaceNotFound();
  if (!can(membership.role, permission)) throw insufficientRole(permission);
  return { workspace, membership, role: membership.role };
}

/**
 * Resolves a document through its workspace membership and checks the permission.
 * Trashed documents are only reachable when `allowTrashed` is set.
 */
export async function authorizeDocument(user, documentId, permission, { allowTrashed = false } = {}) {
  if (!isObjectId(String(documentId))) throw documentNotFound();
  const document = await Document.findById(documentId).lean();
  if (!document) throw documentNotFound();
  const membership = await findMembership(user._id, document.workspaceId);
  if (!membership) throw documentNotFound();
  if (document.deletedAt && !allowTrashed) {
    throw notFound('document_trashed', 'This document is in the trash. Restore it to open it.');
  }
  if (!can(membership.role, permission)) throw insufficientRole(permission);
  return { document, membership, role: membership.role };
}

export async function userWorkspaceIds(userId) {
  const memberships = await Membership.find({ userId }, { workspaceId: 1 }).lean();
  return memberships.map((membership) => membership.workspaceId);
}

export function toObjectId(id) {
  return new mongoose.Types.ObjectId(String(id));
}
