#!/usr/bin/env node
// Measures SyncSpace synchronisation on this machine with the real server and the real sync engine.
//   node scripts/measure-sync.js [--clients 5] [--edits 200] [--out docs/measurements/latest.json]
// Uses an ephemeral MongoDB (mongodb-memory-server) unless MEASURE_MONGODB_URI is set.
// Everything runs over loopback: results show server + database cost, not internet latency.
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import pino from 'pino';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { DocSyncSession, manualNetwork } from '@syncspace/sync-client';
import { readConfig } from '../apps/server/src/config.js';
import { connectDatabase, disconnectDatabase, ensureIndexes } from '../apps/server/src/db.js';
import { startServer } from '../apps/server/src/server.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => (value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1]]] : pairs), []),
);
const CLIENTS = Number(args.clients ?? 5);
const EDITS = Number(args.edits ?? 200);
const OUT = args.out ?? 'docs/measurements/latest.json';
const ORIGIN = 'http://localhost:5173';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (n) => Math.round(n * 100) / 100;
function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { samples: sorted.length, p50: round(at(0.5)), p95: round(at(0.95)), p99: round(at(0.99)), max: round(sorted.at(-1)) };
}

async function waitFor(predicate, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await sleep(1);
  }
}

// ---- Server ---------------------------------------------------------------------------
let mongod;
const base = process.env.MEASURE_MONGODB_URI ?? (mongod = await MongoMemoryServer.create()).getUri();
const uri = new URL(base);
uri.pathname = `/syncspace_measure_${Date.now()}`;
const logger = pino({ level: 'silent' });
await connectDatabase({ uri: uri.toString(), logger, maxAttempts: 3 });
await ensureIndexes();
const config = { ...readConfig({ NODE_ENV: 'test', MONGODB_URI: uri.toString(), APP_ORIGINS: ORIGIN }), rateLimits: { login: 10_000, register: 10_000 } };
const server = await startServer({ config, logger, port: 0 });

async function api(method, path, body, cookie) {
  const response = await fetch(`${server.url}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'X-SyncSpace-Request': '1', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  return { data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

const people = [];
for (let i = 0; i < CLIENTS; i += 1) {
  const { data, cookie } = await api('POST', '/auth/register', { name: `Writer ${i}`, email: `writer${i}@measure.test`, password: 'measure passphrase' });
  people.push({ user: data.user, cookie });
}
const { data: ws } = await api('POST', '/workspaces', { name: 'Measurements' }, people[0].cookie);
for (const person of people.slice(1)) {
  const { data } = await api('POST', `/workspaces/${ws.workspace.id}/invitations`, { email: person.user.email, role: 'editor' }, people[0].cookie);
  await api('POST', `/invitations/${data.token}/accept`, undefined, person.cookie);
}
const { data: created } = await api('POST', `/workspaces/${ws.workspace.id}/documents`, { title: 'Latency' }, people[0].cookie);
const docId = created.document.id;

function open(person, network = manualNetwork(true)) {
  const session = new DocSyncSession({
    docId,
    url: `${server.url.replace(/^http/, 'ws')}/ws/documents/${docId}`,
    createSocket: (url) => new WebSocket(url, { headers: { cookie: person.cookie, origin: ORIGIN } }),
    network,
    options: { batchMs: 0 },
  });
  return session;
}

const textOf = (session) => session.doc.getXmlFragment('default').toString();
function appendParagraph(session, text) {
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.insert(0, [new Y.XmlText(text)]);
  const fragment = session.doc.getXmlFragment('default');
  fragment.insert(fragment.length, [paragraph]);
}

const results = {
  measuredAt: new Date().toISOString(),
  environment: {
    os: `${os.type()} ${os.release()}`,
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 1e9),
    node: process.version,
    mongodb: mongod ? `mongodb-memory-server ${mongod.opts?.binary?.version ?? '(default)'}` : 'MEASURE_MONGODB_URI',
    transport: 'loopback (same machine)',
  },
  parameters: { clients: CLIENTS, sequentialEdits: EDITS },
};

// ---- 1. Propagation and durability, one writer ------------------------------------------
const sessions = people.map((person) => open(person));
await Promise.all(sessions.map((session) => session.start()));
await waitFor(() => sessions.every((session) => session.state.serverSynced));

const propagation = [];
const durability = [];
for (let i = 0; i < EDITS; i += 1) {
  const writer = sessions[i % CLIENTS];
  const marker = `m${i}x`;
  const startedAt = performance.now();
  appendParagraph(writer, marker);
  const version = writer.state.localVersion;
  const others = sessions.filter((session) => session !== writer);
  const seen = await Promise.all(
    others.map(async (session) => {
      await waitFor(() => textOf(session).includes(marker));
      return performance.now() - startedAt;
    }),
  );
  propagation.push(Math.max(...seen));
  await waitFor(() => writer.state.durableVersion >= version);
  durability.push(performance.now() - startedAt);
}
results.propagationToAllCollaboratorsMs = summary(propagation);
results.storedOnServerAckMs = summary(durability);

// ---- 2. Everyone typing at once -----------------------------------------------------------
const CONCURRENT_EDITS = 100;
const concurrentAck = [];
const burstStarted = performance.now();
await Promise.all(
  sessions.map(async (session, index) => {
    for (let i = 0; i < CONCURRENT_EDITS; i += 1) {
      const startedAt = performance.now();
      appendParagraph(session, `c${index}-${i}`);
      const version = session.state.localVersion;
      await waitFor(() => session.state.durableVersion >= version);
      concurrentAck.push(performance.now() - startedAt);
      await sleep(5);
    }
  }),
);
await waitFor(() => new Set(sessions.map(textOf)).size === 1);
results.concurrentTyping = {
  writers: CLIENTS,
  editsPerWriter: CONCURRENT_EDITS,
  storedOnServerAckMs: summary(concurrentAck),
  allConvergedAfterMs: round(performance.now() - burstStarted),
};

// ---- 3. Reconnect catch-up -------------------------------------------------------------
const network = manualNetwork(true);
const traveller = open(people[0], network);
await traveller.start();
await waitFor(() => traveller.state.serverSynced);
network.set(false);
for (let i = 0; i < 200; i += 1) appendParagraph(sessions[1], `while away ${i}`);
for (let i = 0; i < 20; i += 1) appendParagraph(traveller, `offline ${i}`);
await waitFor(() => sessions[1].pendingCount === 0);
const reconnectStarted = performance.now();
network.set(true);
await waitFor(() => traveller.pendingCount === 0 && traveller.state.serverSynced && textOf(traveller) === textOf(sessions[1]));
results.reconnectCatchUp = {
  missedRemoteEdits: 200,
  offlineLocalEdits: 20,
  convergedAndStoredMs: round(performance.now() - reconnectStarted),
};

// ---- 4. Cold load of the resulting document -----------------------------------------------
await Promise.all([...sessions, traveller].map((session) => session.destroy()));
await sleep(200);
const coldLoads = [];
for (let i = 0; i < 10; i += 1) {
  const startedAt = performance.now();
  const reader = open(people[i % CLIENTS]);
  await reader.start();
  await waitFor(() => reader.state.serverSynced);
  coldLoads.push(performance.now() - startedAt);
  if (i === 0) results.documentSize = { paragraphs: reader.doc.getXmlFragment('default').length, stateBytes: Y.encodeStateAsUpdate(reader.doc).byteLength };
  await reader.destroy();
}
results.coldOpenMs = summary(coldLoads);
results.serverMetrics = server.ctx.metrics.snapshot();

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));

await server.close({ graceful: true });
await mongoose.connection.dropDatabase();
await disconnectDatabase();
await mongod?.stop();
