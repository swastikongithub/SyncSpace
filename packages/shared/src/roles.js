// The single role model shared by server enforcement and client UI.
// The server is the authority; the client only uses this to decide what to show.

export const ROLES = Object.freeze(['owner', 'editor', 'viewer']);
export const INVITABLE_ROLES = Object.freeze(['owner', 'editor', 'viewer']);

const RANK = Object.freeze({ viewer: 1, editor: 2, owner: 3 });

/** Minimum role required for each permission. */
export const PERMISSIONS = Object.freeze({
  'workspace.read': 'viewer',
  'workspace.rename': 'owner',
  'workspace.delete': 'owner',
  'members.read': 'viewer',
  'members.manage': 'owner',
  'activity.read': 'viewer',
  'doc.read': 'viewer',
  'doc.create': 'editor',
  'doc.edit': 'editor',
  'doc.organize': 'editor',
  'doc.trash': 'editor',
  'doc.untrash': 'editor',
  'doc.purge': 'owner',
  'history.read': 'viewer',
  'history.snapshot': 'editor',
  'history.restore': 'editor',
});

export function isRole(value) {
  return typeof value === 'string' && Object.hasOwn(RANK, value);
}

export function roleAtLeast(role, minimum) {
  return isRole(role) && isRole(minimum) && RANK[role] >= RANK[minimum];
}

export function can(role, permission) {
  const minimum = PERMISSIONS[permission];
  if (!minimum) throw new Error(`Unknown permission: ${permission}`);
  return roleAtLeast(role, minimum);
}
