// Small, non-sensitive facts remembered in localStorage so the app can start offline.
// No tokens or document content are stored here: the session cookie is HttpOnly, and
// documents live in a per-user IndexedDB database.
const LAST_USER = 'syncspace:last-user';
const PENDING_SIGN_OUT = 'syncspace:pending-sign-out';
const LAST_WORKSPACE = 'syncspace:last-workspace';

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode, quota); the app still works online.
  }
}

export const deviceMemory = {
  lastUser: () => read(LAST_USER),
  setLastUser: (user) => write(LAST_USER, user ? { id: user.id, name: user.name, email: user.email, ply: user.ply } : null),
  pendingSignOut: () => read(PENDING_SIGN_OUT) === true,
  setPendingSignOut: (value) => write(PENDING_SIGN_OUT, value ? true : null),
  lastWorkspace: (userId) => read(`${LAST_WORKSPACE}:${userId}`),
  setLastWorkspace: (userId, workspaceId) => write(`${LAST_WORKSPACE}:${userId}`, workspaceId),
};
