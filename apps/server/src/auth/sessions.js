import { createHash, randomBytes } from 'node:crypto';
import mongoose from 'mongoose';

// Sessions are opaque random tokens. Only a SHA-256 hash is stored, so a database leak does
// not hand out working session cookies.
const sessionSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  createdAt: { type: Date, required: true },
  lastSeenAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  userAgent: { type: String, maxlength: 200 },
});
// MongoDB's TTL monitor removes expired sessions; lookups also check expiry explicitly.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = mongoose.model('Session', sessionSchema);

const TOUCH_INTERVAL_MS = 5 * 60_000;

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function createSessionStore({ ttlMs, idleMs, now = () => Date.now() }) {
  return {
    async create(userId, { userAgent } = {}) {
      const token = randomBytes(32).toString('base64url');
      const at = new Date(now());
      const session = await Session.create({
        tokenHash: hashToken(token),
        userId,
        createdAt: at,
        lastSeenAt: at,
        expiresAt: new Date(at.getTime() + ttlMs),
        userAgent: userAgent?.slice(0, 200),
      });
      return { token, session };
    },

    /** Returns the live session for a token, or null if it is unknown, expired or idle too long. */
    async find(token) {
      if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
      const session = await Session.findOne({ tokenHash: hashToken(token) }).lean();
      if (!session) return null;
      const at = now();
      if (session.expiresAt.getTime() <= at || at - session.lastSeenAt.getTime() > idleMs) {
        await Session.deleteOne({ _id: session._id });
        return null;
      }
      if (at - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
        await Session.updateOne({ _id: session._id }, { lastSeenAt: new Date(at) });
      }
      return session;
    },

    /** Re-checks a session by id (used by long-lived WebSocket connections). */
    async isLive(sessionId) {
      const session = await Session.findById(sessionId, { expiresAt: 1, lastSeenAt: 1 }).lean();
      if (!session) return false;
      const at = now();
      return session.expiresAt.getTime() > at && at - session.lastSeenAt.getTime() <= idleMs;
    },

    async destroy(sessionId) {
      await Session.deleteOne({ _id: sessionId });
    },
  };
}
