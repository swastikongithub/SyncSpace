import { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { LIMITS, plyForSeed } from '@syncspace/shared';
import { conflict, unauthorized } from '../http/errors.js';
import { parse } from '../http/validate.js';
import { publicUser, User } from '../users/model.js';
import { burnVerification, hashPassword, verifyPassword } from './passwords.js';
import { requireAuth } from './middleware.js';

const email = z.string().trim().toLowerCase().max(LIMITS.emailMax).pipe(z.email('Enter a valid email address.'));
const password = z
  .string()
  .min(LIMITS.passwordMin, `Use at least ${LIMITS.passwordMin} characters.`)
  .max(LIMITS.passwordMax, `Use at most ${LIMITS.passwordMax} characters.`);

const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(LIMITS.userNameMax),
  email,
  password,
});
const loginSchema = z.object({ email, password: z.string().min(1, 'Enter your password.').max(LIMITS.passwordMax) });

export function authRoutes(ctx) {
  const { sessions, cookie, rateLimits } = ctx;
  const router = Router();

  const limiter = (options) =>
    rateLimit({
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (req, res) =>
        res.status(429).json({
          error: { code: 'rate_limited', message: 'Too many attempts. Wait a few minutes and try again.' },
        }),
      ...options,
    });

  const loginLimiter = limiter({
    windowMs: 15 * 60_000,
    limit: rateLimits.login,
    // Per address + account, so one attacker cannot lock everyone out and one account cannot be sprayed.
    keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? '')}:${String(req.body?.email ?? '').toLowerCase()}`,
  });
  const registerLimiter = limiter({ windowMs: 60 * 60_000, limit: rateLimits.register });

  function issueSession(res, token) {
    res.cookie(cookie.name, token, {
      httpOnly: true,
      secure: cookie.secure,
      sameSite: 'lax',
      path: '/',
      maxAge: cookie.maxAgeMs,
    });
  }

  router.post('/register', registerLimiter, async (req, res) => {
    const input = parse(registerSchema, req.body);
    if (input.password.toLowerCase() === input.email) {
      throw conflict('weak_password', 'Your password cannot be your email address.');
    }
    const passwordHash = await hashPassword(input.password);
    let user;
    try {
      const _id = new User()._id;
      user = await User.create({ _id, name: input.name, email: input.email, passwordHash, ply: plyForSeed(_id) });
    } catch (error) {
      if (error?.code === 11000) throw conflict('email_taken', 'An account with this email already exists. Sign in instead.');
      throw error;
    }
    const { token } = await sessions.create(user._id, { userAgent: req.get('user-agent') });
    issueSession(res, token);
    res.status(201).json({ user: publicUser(user) });
  });

  router.post('/login', loginLimiter, async (req, res) => {
    const input = parse(loginSchema, req.body);
    const user = await User.findOne({ email: input.email }).select('+passwordHash').lean();
    if (!user) {
      await burnVerification(input.password);
      throw unauthorized('invalid_credentials', 'That email and password do not match an account.');
    }
    if (!(await verifyPassword(user.passwordHash, input.password))) {
      throw unauthorized('invalid_credentials', 'That email and password do not match an account.');
    }
    // A fresh session on every sign-in prevents session fixation; the previous one is ended.
    if (req.auth) await sessions.destroy(req.auth.session._id);
    const { token } = await sessions.create(user._id, { userAgent: req.get('user-agent') });
    issueSession(res, token);
    res.json({ user: publicUser(user) });
  });

  router.post('/logout', async (req, res) => {
    if (req.auth) {
      await sessions.destroy(req.auth.session._id);
      ctx.collab?.closeSession(String(req.auth.session._id));
    }
    res.clearCookie(cookie.name, { httpOnly: true, secure: cookie.secure, sameSite: 'lax', path: '/' });
    res.status(204).end();
  });

  router.get('/session', requireAuth, (req, res) => {
    res.json({ user: publicUser(req.auth.user), expiresAt: req.auth.session.expiresAt });
  });

  return router;
}
