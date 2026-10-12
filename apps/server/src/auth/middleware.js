import { parseCookie } from 'cookie';
import { User } from '../users/model.js';
import { unauthorized } from '../http/errors.js';

export function sessionCookieName(secure) {
  // The __Host- prefix makes browsers refuse the cookie unless it is Secure, host-only and Path=/.
  return secure ? '__Host-syncspace' : 'syncspace';
}

export function readSessionToken(headers, cookieName) {
  const header = headers.cookie;
  if (!header) return undefined;
  return parseCookie(header)[cookieName];
}

/** Resolves the session cookie on a request (HTTP or WebSocket upgrade) to { user, session } or null. */
export function createAuthenticator({ sessions, cookieName }) {
  return async function authenticate(headers) {
    const token = readSessionToken(headers, cookieName);
    if (!token) return { auth: null, hadToken: false };
    const session = await sessions.find(token);
    if (!session) return { auth: null, hadToken: true };
    const user = await User.findById(session.userId).lean();
    if (!user) {
      await sessions.destroy(session._id);
      return { auth: null, hadToken: true };
    }
    return { auth: { user, session, token }, hadToken: true };
  };
}

export function attachAuth(authenticate) {
  return async (req, res, next) => {
    const { auth, hadToken } = await authenticate(req.headers);
    req.auth = auth;
    req.hadSessionToken = hadToken;
    next();
  };
}

export function requireAuth(req, res, next) {
  if (req.auth) return next();
  return next(
    req.hadSessionToken
      ? unauthorized('session_expired', 'Your session has ended. Sign in again to continue.')
      : unauthorized(),
  );
}
