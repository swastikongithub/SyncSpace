import * as encoding from 'lib0/encoding';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { CloseCode, decodeMessage, encodeAwareness, encodeSyncStep1, encodeUpdate, MessageType } from '@syncspace/shared/protocol';
import { DocUpdate } from '../src/collab/models.js';
import { Document } from '../src/documents/model.js';
import {
  addMember,
  bodyText,
  createDocument,
  createWorkspace,
  openSession,
  ORIGIN,
  registerUser,
  startTestServer,
  waitFor,
  waitForDurable,
  waitForSynced,
} from './helpers.js';

let harness;
let owner;
let editor;
let viewer;
let outsider;
let workspace;
const sessions = [];

function track(session) {
  sessions.push(session);
  return session;
}

/** Appends a paragraph with `text` to the document body, the way the editor would. */
function appendParagraph(doc, text) {
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.insert(0, [new Y.XmlText(text)]);
  const fragment = doc.getXmlFragment('default');
  fragment.insert(fragment.length, [paragraph]);
}

function rawSocket(docId, { cookie, origin = ORIGIN } = {}) {
  const headers = { origin };
  if (cookie) headers.cookie = cookie;
  const ws = new WebSocket(`${harness.wsBase}/ws/documents/${docId}`, { headers });
  ws.binaryType = 'arraybuffer';
  return ws;
}

function closeOf(ws) {
  return new Promise((resolve) => ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() })));
}

beforeAll(async () => {
  harness = await startTestServer();
  [owner, editor, viewer, outsider] = await Promise.all([
    registerUser(harness, { name: 'Owner' }),
    registerUser(harness, { name: 'Editor' }),
    registerUser(harness, { name: 'Viewer' }),
    registerUser(harness, { name: 'Outsider' }),
  ]);
  workspace = await createWorkspace(owner);
  await addMember(owner, editor, workspace.id, 'editor');
  await addMember(owner, viewer, workspace.id, 'viewer');
});
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.destroy()));
});
afterAll(async () => {
  await harness.stop();
});

describe('WebSocket authorisation', () => {
  it('closes unauthenticated connections with 4401', async () => {
    const doc = await createDocument(owner, workspace.id);
    const closed = await closeOf(rawSocket(doc.id));
    expect(closed.code).toBe(CloseCode.Unauthenticated);
  });

  it('refuses the handshake from a foreign origin even with a valid cookie', async () => {
    const doc = await createDocument(owner, workspace.id);
    const ws = rawSocket(doc.id, { cookie: owner.cookie, origin: 'https://evil.example' });
    const status = await new Promise((resolve) => ws.on('unexpected-response', (req, res) => resolve(res.statusCode)));
    expect(status).toBe(403);
  });

  it('closes connections from non-members with 4404 and never sends content', async () => {
    const doc = await createDocument(owner, workspace.id, 'Secret plans');
    const ws = rawSocket(doc.id, { cookie: outsider.cookie });
    const received = [];
    ws.on('message', (data) => received.push(decodeMessage(new Uint8Array(data)).type));
    const closed = await closeOf(ws);
    expect(closed.code).toBe(CloseCode.NotFound);
    expect(received.every((type) => type === MessageType.Control)).toBe(true);
  });

  it('rejects unknown and trashed documents', async () => {
    const missing = await closeOf(rawSocket('0123456789abcdef01234567', { cookie: owner.cookie }));
    expect(missing.code).toBe(CloseCode.NotFound);
    const doc = await createDocument(owner, workspace.id);
    await owner.post(`/api/documents/${doc.id}/trash`);
    const trashed = await closeOf(rawSocket(doc.id, { cookie: owner.cookie }));
    expect(trashed.code).toBe(CloseCode.DocumentGone);
  });

  it('closes a malformed frame with 4400', async () => {
    const doc = await createDocument(owner, workspace.id);
    const ws = rawSocket(doc.id, { cookie: owner.cookie });
    await new Promise((resolve) => ws.on('open', resolve));
    ws.send(new Uint8Array([MessageType.Update, 1, 200, 1, 2]));
    expect((await closeOf(ws)).code).toBe(CloseCode.InvalidMessage);
  });
});

describe('real-time collaboration', () => {
  it('delivers the initial state and converges concurrent edits from two editors', async () => {
    const doc = await createDocument(owner, workspace.id, 'Shared notes');
    const a = track(openSession(harness, owner, doc.id));
    const b = track(openSession(harness, editor, doc.id));
    await Promise.all([a.start(), b.start()]);
    await Promise.all([waitForSynced(a), waitForSynced(b)]);
    expect(a.doc.getXmlFragment('default').get(0).toString()).toContain('Shared notes');

    // Both edit the same paragraph "at the same time" (before seeing each other's change).
    const textA = a.doc.getXmlFragment('default').get(1);
    const textB = b.doc.getXmlFragment('default').get(1);
    textA.insert(0, [new Y.XmlText('alpha ')]);
    textB.insert(0, [new Y.XmlText('beta ')]);
    appendParagraph(a.doc, 'from A');
    appendParagraph(b.doc, 'from B');

    await waitFor(() => bodyText(a.doc) === bodyText(b.doc) && bodyText(a.doc).includes('from A') && bodyText(a.doc).includes('from B'), {
      message: 'replicas to converge',
    });
    expect(a.doc.getXmlFragment('default').toString()).toBe(b.doc.getXmlFragment('default').toString());
    await Promise.all([waitForDurable(a), waitForDurable(b)]);
  });

  it('acknowledges a change only once it is stored in MongoDB', async () => {
    const doc = await createDocument(owner, workspace.id);
    const a = track(openSession(harness, owner, doc.id));
    await a.start();
    await waitForSynced(a);
    const before = await DocUpdate.countDocuments({ docId: doc.id });
    appendParagraph(a.doc, 'durable text');
    expect(a.pendingCount).toBe(1);
    await waitForDurable(a);
    expect(await DocUpdate.countDocuments({ docId: doc.id })).toBeGreaterThan(before);
    const stored = await DocUpdate.find({ docId: doc.id }).sort({ seq: 1 }).lean();
    const replica = new Y.Doc();
    for (const entry of stored) Y.applyUpdate(replica, entry.update.read(0, entry.update.length()));
    expect(bodyText(replica)).toContain('durable text');
  });

  it('stores a replayed update only once', async () => {
    const doc = await createDocument(owner, workspace.id);
    const source = new Y.Doc();
    const ws = rawSocket(doc.id, { cookie: owner.cookie });
    const acks = [];
    ws.on('message', (data) => {
      const message = decodeMessage(new Uint8Array(data));
      if (message.type === MessageType.SyncStep2) Y.applyUpdate(source, message.update);
      if (message.type === MessageType.Ack) acks.push(message.ackId);
    });
    await new Promise((resolve) => ws.on('open', resolve));
    ws.send(encodeSyncStep1(Y.encodeStateVector(source)));
    await waitFor(() => source.getXmlFragment('default').length > 0, { message: 'initial state' });

    let update;
    source.once('update', (u) => {
      update = u;
    });
    appendParagraph(source, 'only once');
    const countBefore = await DocUpdate.countDocuments({ docId: doc.id });
    ws.send(encodeUpdate(update, 1));
    ws.send(encodeUpdate(update, 2));
    ws.send(encodeUpdate(update, 3));
    await waitFor(() => acks.length === 3, { message: 'three acks' });
    expect(await DocUpdate.countDocuments({ docId: doc.id })).toBe(countBefore + 1);
    ws.close();
  });

  it('keeps content through a graceful restart and through a crash', async () => {
    const doc = await createDocument(owner, workspace.id, 'Restart me');
    const a = track(openSession(harness, owner, doc.id));
    await a.start();
    await waitForSynced(a);
    appendParagraph(a.doc, 'before graceful restart');
    await waitForDurable(a);

    await harness.restart({ graceful: true });
    await waitFor(() => a.state.connection === 'connected' && a.state.serverSynced, { message: 'reconnect after restart' });
    appendParagraph(a.doc, 'before crash');
    await waitForDurable(a);

    // A crash: sockets dropped, rooms discarded, nothing flushed or compacted.
    await harness.restart({ graceful: false });
    const fresh = track(openSession(harness, editor, doc.id));
    await fresh.start();
    await waitForSynced(fresh);
    expect(bodyText(fresh.doc)).toContain('before graceful restart');
    expect(bodyText(fresh.doc)).toContain('before crash');
  });

  it('a reconnecting client catches up without duplicating or losing changes', async () => {
    const doc = await createDocument(owner, workspace.id);
    const a = track(openSession(harness, owner, doc.id));
    const b = track(openSession(harness, editor, doc.id));
    await Promise.all([a.start(), b.start()]);
    await Promise.all([waitForSynced(a), waitForSynced(b)]);

    a.socket.terminate?.() ?? a.socket.close();
    appendParagraph(b.doc, 'while A was away');
    appendParagraph(a.doc, 'A wrote this before noticing');
    await waitFor(() => bodyText(a.doc).includes('while A was away') && bodyText(b.doc).includes('A wrote this'), {
      message: 'catch-up after reconnect',
    });
    await Promise.all([waitForDurable(a), waitForDurable(b)]);
    expect(bodyText(a.doc)).toBe(bodyText(b.doc));
    expect(bodyText(a.doc).match(/while A was away/g)).toHaveLength(1);
    expect(bodyText(a.doc).match(/A wrote this/g)).toHaveLength(1);
  });

  it('derives the title, excerpt and word count for listings', async () => {
    const doc = await createDocument(owner, workspace.id, 'Derived');
    const a = track(openSession(harness, owner, doc.id));
    await a.start();
    await waitForSynced(a);
    appendParagraph(a.doc, 'Entropy always increases in an isolated system');
    await waitForDurable(a);
    await waitFor(async () => (await Document.findById(doc.id).lean()).wordCount === 7, { message: 'derived metadata' });
    const stored = await Document.findById(doc.id).lean();
    expect(stored.excerpt).toBe('Entropy always increases in an isolated system.');
    const search = await editor.get('/api/search').query({ q: 'isolated' });
    expect(search.body.results[0]).toMatchObject({ id: doc.id, matchedIn: 'content' });
  });
});

describe('roles over the socket', () => {
  it('lets viewers watch but refuses their changes without acknowledging them', async () => {
    const doc = await createDocument(owner, workspace.id);
    const writer = track(openSession(harness, owner, doc.id));
    const reader = track(openSession(harness, viewer, doc.id));
    await Promise.all([writer.start(), reader.start()]);
    await Promise.all([waitForSynced(writer), waitForSynced(reader)]);
    expect(reader.state.role).toBe('viewer');

    appendParagraph(writer.doc, 'visible to the viewer');
    await waitFor(() => bodyText(reader.doc).includes('visible to the viewer'), { message: 'viewer receives updates' });

    const errors = [];
    reader.on('server-error', (control) => errors.push(control.code));
    appendParagraph(reader.doc, 'viewer tries to write');
    await waitFor(() => errors.includes('read_only'), { message: 'read-only rejection' });
    expect(reader.pendingCount).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(bodyText(writer.doc)).not.toContain('viewer tries to write');
  });

  it('applies role changes to open connections, and sends held-back changes after promotion', async () => {
    const member = await registerUser(harness);
    await addMember(owner, member, workspace.id, 'editor');
    const doc = await createDocument(owner, workspace.id);
    const watcher = track(openSession(harness, owner, doc.id));
    const s = track(openSession(harness, member, doc.id));
    await Promise.all([watcher.start(), s.start()]);
    await Promise.all([waitForSynced(watcher), waitForSynced(s)]);

    await owner.patch(`/api/workspaces/${workspace.id}/members/${member.user.id}`, { role: 'viewer' });
    await waitFor(() => s.state.role === 'viewer', { message: 'demotion delivered' });
    appendParagraph(s.doc, 'written while demoted');
    await waitFor(() => s.state.readOnlyRejected, { message: 'rejected while viewer' });
    expect(s.pendingCount).toBeGreaterThan(0);

    await owner.patch(`/api/workspaces/${workspace.id}/members/${member.user.id}`, { role: 'editor' });
    await waitForDurable(s, 'held-back change to be stored after promotion');
    await waitFor(() => bodyText(watcher.doc).includes('written while demoted'), { message: 'change reaches others' });
  });

  it('disconnects members as soon as they are removed', async () => {
    const member = await registerUser(harness);
    await addMember(owner, member, workspace.id, 'editor');
    const doc = await createDocument(owner, workspace.id);
    const s = track(openSession(harness, member, doc.id));
    await s.start();
    await waitForSynced(s);
    await owner.delete(`/api/workspaces/${workspace.id}/members/${member.user.id}`);
    await waitFor(() => s.state.connection === 'blocked', { message: 'removed member blocked' });
    expect(s.state.blocked.code).toBe(CloseCode.AccessRevoked);
  });

  it('closes a session’s sockets when it signs out', async () => {
    const member = await registerUser(harness);
    await addMember(owner, member, workspace.id, 'editor');
    const doc = await createDocument(owner, workspace.id);
    const s = track(openSession(harness, member, doc.id));
    await s.start();
    await waitForSynced(s);
    await member.post('/api/auth/logout');
    await waitFor(() => s.state.connection === 'blocked', { message: 'signed-out socket closed' });
    expect(s.state.blocked.code).toBe(CloseCode.Unauthenticated);
  });
});

describe('presence', () => {
  it('replaces any claimed identity with the authenticated one', async () => {
    const doc = await createDocument(owner, workspace.id);
    const honest = track(openSession(harness, owner, doc.id));
    const liar = track(openSession(harness, editor, doc.id));
    await Promise.all([honest.start(), liar.start()]);
    await Promise.all([waitForSynced(honest), waitForSynced(liar)]);
    liar.setPresence({ user: { id: owner.user.id, name: 'Owner', ply: 'canary' }, typing: true });
    await waitFor(() => honest.awareness.getStates().get(liar.doc.clientID)?.typing === true, { message: 'presence arrives' });
    const seen = honest.awareness.getStates().get(liar.doc.clientID);
    expect(seen.user).toMatchObject({ id: editor.user.id, name: 'Editor', role: 'editor' });
    expect(seen.typing).toBe(true);
  });

  it('removes presence when a collaborator disconnects', async () => {
    const doc = await createDocument(owner, workspace.id);
    const a = track(openSession(harness, owner, doc.id));
    const b = track(openSession(harness, editor, doc.id));
    await Promise.all([a.start(), b.start()]);
    await Promise.all([waitForSynced(a), waitForSynced(b)]);
    b.setPresence({ typing: false });
    await waitFor(() => a.awareness.getStates().has(b.doc.clientID), { message: 'presence arrives' });
    const clientId = b.doc.clientID;
    await b.destroy();
    await waitFor(() => !a.awareness.getStates().has(clientId), { message: 'presence removed' });
  });

  it('refuses to let one connection speak for another connection’s presence', async () => {
    const doc = await createDocument(owner, workspace.id);
    const victim = track(openSession(harness, owner, doc.id));
    await victim.start();
    await waitForSynced(victim);
    victim.setPresence({ typing: true });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const ws = rawSocket(doc.id, { cookie: editor.cookie });
    await new Promise((resolve) => ws.on('open', resolve));
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 1);
    encoding.writeVarUint(encoder, victim.doc.clientID);
    encoding.writeVarUint(encoder, 999);
    encoding.writeVarString(encoder, 'null');
    ws.send(encodeAwareness(encoding.toUint8Array(encoder)));
    expect((await closeOf(ws)).code).toBe(CloseCode.InvalidMessage);
  });
});

describe('storage', () => {
  it('compacts the update log into a checkpoint without changing content', async () => {
    const doc = await createDocument(owner, workspace.id);
    const a = track(openSession(harness, owner, doc.id, { options: { batchMs: 0 } }));
    await a.start();
    await waitForSynced(a);
    // One frame per edit, so the server log really holds 260 separate updates.
    for (let i = 0; i < 260; i += 1) {
      appendParagraph(a.doc, `line ${i}`);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    await waitForDurable(a);
    const stats = await harness.server.ctx.store.stats(doc.id);
    expect(stats.checkpointSeq).toBeGreaterThan(0);
    expect(stats.updates).toBeLessThan(200);

    await harness.restart({ graceful: false });
    const fresh = track(openSession(harness, editor, doc.id));
    await fresh.start();
    await waitForSynced(fresh);
    expect(bodyText(fresh.doc)).toBe(bodyText(a.doc));
  });

  it('evicts the room on a failed write so clients resend everything that was not acknowledged', async () => {
    const doc = await createDocument(owner, workspace.id);
    const a = track(openSession(harness, owner, doc.id));
    const b = track(openSession(harness, editor, doc.id));
    await Promise.all([a.start(), b.start()]);
    await Promise.all([waitForSynced(a), waitForSynced(b)]);

    const { store } = harness.server.ctx;
    const append = store.append;
    let failures = 0;
    store.append = async (...args) => {
      if (failures === 0) {
        failures += 1;
        throw new Error('simulated write failure');
      }
      return append(...args);
    };
    try {
      appendParagraph(a.doc, 'survives a failed write');
      await waitFor(() => failures === 1, { message: 'write failure' });
      await waitForDurable(a, 'change to be stored after the retry');
      await waitFor(() => bodyText(b.doc).includes('survives a failed write'), { message: 'collaborator has it' });
    } finally {
      store.append = append;
    }
    await harness.restart({ graceful: false });
    const fresh = track(openSession(harness, editor, doc.id));
    await fresh.start();
    await waitForSynced(fresh);
    expect(bodyText(fresh.doc)).toContain('survives a failed write');
  });
});
