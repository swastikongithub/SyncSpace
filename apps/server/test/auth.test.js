import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Session } from '../src/auth/sessions.js';
import { User } from '../src/users/model.js';
import { apiClient, ORIGIN, registerUser, startTestServer } from './helpers.js';

let harness;
beforeAll(async () => {
  harness = await startTestServer();
});
afterAll(async () => {
  await harness.stop();
});

describe('registration', () => {
  it('creates an account, signs the user in with an HttpOnly SameSite cookie, and never stores the password', async () => {
    const client = apiClient(harness);
    const res = await client.post('/api/auth/register', { name: 'Ana', email: 'Ana@Example.test', password: 'a long passphrase' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Ana', email: 'ana@example.test' });
    expect(res.body.user).not.toHaveProperty('passwordHash');

    const cookie = res.headers['set-cookie'][0];
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const stored = await User.findOne({ email: 'ana@example.test' }).select('+passwordHash').lean();
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.passwordHash).not.toContain('a long passphrase');

    const session = await client.get('/api/auth/session');
    expect(session.status).toBe(200);
    expect(session.body.user.email).toBe('ana@example.test');
  });

  it('rejects a duplicate email with 409', async () => {
    await registerUser(harness, { email: 'dup@example.test' });
    const res = await apiClient(harness).post('/api/auth/register', { name: 'Again', email: 'DUP@example.test', password: 'another passphrase' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('email_taken');
  });

  it('validates input and reports field errors consistently', async () => {
    const res = await apiClient(harness).post('/api/auth/register', { name: '', email: 'not-an-email', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
    expect(Object.keys(res.body.error.details.fieldErrors).sort()).toEqual(['email', 'name', 'password']);
  });
});

describe('login and sessions', () => {
  it('signs in with correct credentials and gives the same answer for a wrong password and an unknown email', async () => {
    const user = await registerUser(harness, { email: 'login@example.test', password: 'the right passphrase' });
    const ok = await apiClient(harness).post('/api/auth/login', { email: 'login@example.test', password: 'the right passphrase' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.id).toBe(user.user.id);

    const wrong = await apiClient(harness).post('/api/auth/login', { email: 'login@example.test', password: 'the wrong passphrase' });
    const unknown = await apiClient(harness).post('/api/auth/login', { email: 'nobody@example.test', password: 'the wrong passphrase' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('issues a new session on every sign-in and ends the previous one', async () => {
    const client = await registerUser(harness, { email: 'rotate@example.test', password: 'rotating passphrase' });
    const before = await Session.countDocuments({ userId: client.user.id });
    const res = await client.post('/api/auth/login', { email: 'rotate@example.test', password: 'rotating passphrase' });
    expect(res.status).toBe(200);
    expect(await Session.countDocuments({ userId: client.user.id })).toBe(before);
    expect(res.headers['set-cookie'][0].split(';')[0]).not.toBe(client.cookie);
  });

  it('stores only a hash of the session token', async () => {
    const client = await registerUser(harness);
    const token = decodeURIComponent(client.cookie.split('=')[1]);
    const sessions = await Session.find({ userId: client.user.id }).lean();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].tokenHash).not.toBe(token);
    expect(sessions[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('logs out by destroying the session server-side', async () => {
    const client = await registerUser(harness);
    const out = await client.post('/api/auth/logout');
    expect(out.status).toBe(204);
    // Replaying the old cookie must not work: the session no longer exists.
    const replay = await apiClient(harness).get('/api/auth/session').set('Cookie', client.cookie);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('session_expired');
  });

  it('expires sessions past their lifetime and after the idle timeout', async () => {
    const expired = await registerUser(harness);
    await Session.updateMany({ userId: expired.user.id }, { expiresAt: new Date(Date.now() - 1000) });
    const res1 = await expired.get('/api/auth/session');
    expect(res1.status).toBe(401);
    expect(res1.body.error.code).toBe('session_expired');

    const idle = await registerUser(harness);
    await Session.updateMany({ userId: idle.user.id }, { lastSeenAt: new Date(Date.now() - harness.config.session.idleMs - 1000) });
    const res2 = await idle.get('/api/auth/session');
    expect(res2.status).toBe(401);
    expect(await Session.countDocuments({ userId: idle.user.id })).toBe(0);
  });

  it('answers 401 unauthenticated without a cookie', async () => {
    const res = await apiClient(harness).get('/api/auth/session');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthenticated');
  });
});

describe('cross-site request forgery defences', () => {
  it('rejects state-changing requests without the SyncSpace request header', async () => {
    const client = await registerUser(harness);
    const res = await client.agent.post('/api/workspaces').set('Origin', ORIGIN).send({ name: 'Sneaky' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('missing_request_header');
  });

  it('rejects requests from a foreign origin even with the header and a valid cookie', async () => {
    const client = await registerUser(harness);
    const res = await client.agent
      .post('/api/workspaces')
      .set('Origin', 'https://evil.example')
      .set('X-SyncSpace-Request', '1')
      .send({ name: 'Sneaky' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('origin_not_allowed');
  });

  it('rejects requests the browser marks as cross-site', async () => {
    const client = await registerUser(harness);
    const res = await client.agent
      .post('/api/workspaces')
      .set('Sec-Fetch-Site', 'cross-site')
      .set('X-SyncSpace-Request', '1')
      .send({ name: 'Sneaky' });
    expect(res.status).toBe(403);
  });
});

describe('health', () => {
  it('reports database readiness publicly', async () => {
    const res = await apiClient(harness).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'connected' });
  });
});
