import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import pino from 'pino';
import request from 'supertest';
import { inject } from 'vitest';
import { WebSocket } from 'ws';
import { DocSyncSession } from '@syncspace/sync-client';
import { readConfig } from '../src/config.js';
import { connectDatabase, disconnectDatabase, ensureIndexes } from '../src/db.js';
import { startServer } from '../src/server.js';

export const ORIGIN = 'http://localhost:5173';
export const silentLogger = pino({ level: 'silent' });

function databaseUri() {
  const base = new URL(inject('mongoUri'));
  base.pathname = `/syncspace_test_${process.pid}_${randomBytes(4).toString('hex')}`;
  return base.toString();
}

/** Starts a real server (HTTP + WebSocket) on a random port against a fresh database. */
export async function startTestServer({ collabSettings, configOverrides = {} } = {}) {
  const uri = databaseUri();
  await connectDatabase({ uri, logger: silentLogger, maxAttempts: 3, retryMs: 100 });
  await ensureIndexes();
  const config = {
    ...readConfig({ NODE_ENV: 'test', MONGODB_URI: uri, APP_ORIGINS: ORIGIN }),
    rateLimits: { login: 1000, register: 1000 },
    ...configOverrides,
  };
  const settings = { unloadDelayMs: 50, revalidateIntervalMs: 60_000, ...collabSettings };
  const harness = {
    config,
    server: await startServer({ config, logger: silentLogger, collabSettings: settings, port: 0 }),
    /** Stops the server process state (rooms, sockets) and starts a new one on the same port. */
    async restart({ graceful = true } = {}) {
      const { port } = harness.server;
      await harness.server.close({ graceful });
      harness.server = await startServer({ config, logger: silentLogger, collabSettings: settings, port });
    },
    async stop() {
      await harness.server.close({ graceful: false });
      await mongoose.connection.dropDatabase();
      await disconnectDatabase();
    },
    get url() {
      return harness.server.url;
    },
    get wsBase() {
      return harness.server.url.replace(/^http/, 'ws');
    },
  };
  return harness;
}

/** An HTTP client that behaves like the web app: same-origin headers and a cookie jar. */
export function apiClient(harness) {
  const agent = request.agent(harness.url);
  const withHeaders = (req) => req.set('Origin', ORIGIN).set('X-SyncSpace-Request', '1');
  const client = {
    agent,
    cookie: null,
    get: (path) => agent.get(path),
    post: (path, body) => withHeaders(agent.post(path)).send(body ?? {}),
    patch: (path, body) => withHeaders(agent.patch(path)).send(body ?? {}),
    delete: (path, body) => withHeaders(agent.delete(path)).send(body ?? {}),
  };
  return client;
}

let userCounter = 0;

/** Registers a new user and returns a signed-in client plus the session cookie for WebSockets. */
export async function registerUser(harness, { name, email, password = 'correct horse battery' } = {}) {
  userCounter += 1;
  const client = apiClient(harness);
  const res = await client.post('/api/auth/register', {
    name: name ?? `User ${userCounter}`,
    email: email ?? `user${userCounter}-${randomBytes(3).toString('hex')}@example.test`,
    password,
  });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  client.cookie = res.headers['set-cookie'][0].split(';')[0];
  client.user = res.body.user;
  client.password = password;
  return client;
}

export async function createWorkspace(client, name = 'Study group') {
  const res = await client.post('/api/workspaces', { name });
  if (res.status !== 201) throw new Error(`create workspace failed: ${res.status}`);
  return res.body.workspace;
}

export async function createDocument(client, workspaceId, title = 'Notes') {
  const res = await client.post(`/api/workspaces/${workspaceId}/documents`, { title });
  if (res.status !== 201) throw new Error(`create document failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.document;
}

/** Adds `member` to the workspace through the real invitation flow. */
export async function addMember(owner, member, workspaceId, role = 'editor') {
  const invite = await owner.post(`/api/workspaces/${workspaceId}/invitations`, { email: member.user.email, role });
  if (invite.status !== 201) throw new Error(`invite failed: ${invite.status}`);
  const accept = await member.post(`/api/invitations/${invite.body.token}/accept`);
  if (accept.status !== 200) throw new Error(`accept failed: ${accept.status} ${JSON.stringify(accept.body)}`);
}

/** A real sync client (the same engine the browser uses) connected as `client`'s user. */
export function openSession(harness, client, docId, { storage = null, network = null, options } = {}) {
  const session = new DocSyncSession({
    docId,
    url: `${harness.wsBase}/ws/documents/${docId}`,
    createSocket: (url) => new WebSocket(url, { headers: { cookie: client.cookie ?? '', origin: ORIGIN } }),
    storage,
    network,
    options: { minBackoffMs: 20, maxBackoffMs: 200, batchMs: 5, ...options },
  });
  return session;
}

export async function waitFor(predicate, { timeout = 5000, interval = 10, message = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${message}`);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

export function waitForSynced(session, message = 'session to sync') {
  return waitFor(() => session.state.serverSynced && session.state.connection === 'connected', { message });
}

export function waitForDurable(session, message = 'changes to be durable') {
  return waitFor(() => session.pendingCount === 0 && session.state.serverSynced, { message });
}

/** Text of the non-empty body blocks (everything after the title block), one per line. */
export function bodyText(doc) {
  const blocks = doc.getXmlFragment('default').toArray();
  const body = blocks[0]?.nodeName === 'title' ? blocks.slice(1) : blocks;
  return body
    .map((block) => block.toString().replace(/<[^>]+>/g, ''))
    .filter(Boolean)
    .join('\n');
}
