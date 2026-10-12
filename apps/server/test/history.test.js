import { IDBFactory } from 'fake-indexeddb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { manualNetwork, openUserStore } from '@syncspace/sync-client';
import { DocVersion } from '../src/history/model.js';
import {
  addMember,
  apiClient,
  bodyText,
  createDocument,
  createWorkspace,
  openSession,
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
const cleanup = [];

function appendParagraph(doc, text) {
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.insert(0, [new Y.XmlText(text)]);
  const fragment = doc.getXmlFragment('default');
  fragment.insert(fragment.length, [paragraph]);
}

function open(client, docId, extra) {
  const session = openSession(harness, client, docId, extra);
  cleanup.push(() => session.destroy());
  return session;
}

async function versionText(client, docId, versionId) {
  const res = await client.agent.get(`/api/documents/${docId}/versions/${versionId}/content`).buffer(true).parse((response, callback) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => callback(null, Buffer.concat(chunks)));
  });
  expect(res.status).toBe(200);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(res.body));
  return bodyText(doc);
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
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
afterAll(async () => {
  await harness.stop();
});

describe('saving and inspecting versions', () => {
  it('saves a named version of exactly what is stored and serves its content', async () => {
    const doc = await createDocument(owner, workspace.id, 'Essay');
    const s = open(owner, doc.id);
    await s.start();
    await waitForSynced(s);
    appendParagraph(s.doc, 'first draft');
    await waitForDurable(s);

    const saved = await editor.post(`/api/documents/${doc.id}/versions`, { label: 'Draft 1' });
    expect(saved.status).toBe(201);
    expect(saved.body.version).toMatchObject({ kind: 'manual', label: 'Draft 1', title: 'Essay', createdBy: { name: 'Editor' } });

    appendParagraph(s.doc, 'second draft');
    await waitForDurable(s);
    const list = await viewer.get(`/api/documents/${doc.id}/versions`);
    expect(list.status).toBe(200);
    expect(list.body.versions[0].label).toBe('Draft 1');
    expect(await versionText(viewer, doc.id, saved.body.version.id)).toBe('first draft');
  });

  it('records an automatic version when everyone has left a changed document', async () => {
    const doc = await createDocument(owner, workspace.id);
    const s = open(owner, doc.id);
    await s.start();
    await waitForSynced(s);
    appendParagraph(s.doc, 'auto captured');
    await waitForDurable(s);
    await s.destroy();
    await waitFor(async () => (await DocVersion.countDocuments({ docId: doc.id, kind: 'auto' })) === 1, { message: 'auto version on unload' });
  });

  it('enforces history permissions', async () => {
    const doc = await createDocument(owner, workspace.id);
    expect((await viewer.post(`/api/documents/${doc.id}/versions`, { label: 'x' })).status).toBe(403);
    const saved = await owner.post(`/api/documents/${doc.id}/versions`, { label: 'Base' });
    expect((await viewer.post(`/api/documents/${doc.id}/versions/${saved.body.version.id}/restore`)).status).toBe(403);
    expect((await outsider.get(`/api/documents/${doc.id}/versions`)).status).toBe(404);
    expect((await outsider.agent.get(`/api/documents/${doc.id}/versions/${saved.body.version.id}/content`)).status).toBe(404);
    expect((await outsider.post(`/api/documents/${doc.id}/versions/${saved.body.version.id}/restore`)).status).toBe(404);

    // A version id from one document cannot be used through another document.
    const other = await createDocument(owner, workspace.id);
    expect((await owner.post(`/api/documents/${other.id}/versions/${saved.body.version.id}/restore`)).status).toBe(404);
    expect((await apiClient(harness).get(`/api/documents/${doc.id}/versions`)).status).toBe(401);
  });
});

describe('restoring a version', () => {
  it('restores as a forward change that live collaborators receive, keeping a safety copy', async () => {
    const doc = await createDocument(owner, workspace.id, 'Plan');
    const a = open(owner, doc.id);
    const b = open(editor, doc.id);
    await Promise.all([a.start(), b.start()]);
    await Promise.all([waitForSynced(a), waitForSynced(b)]);
    appendParagraph(a.doc, 'good version');
    await waitForDurable(a);
    const good = await owner.post(`/api/documents/${doc.id}/versions`, { label: 'Good' });

    appendParagraph(b.doc, 'regrettable change');
    await waitForDurable(b);
    await waitFor(() => bodyText(a.doc).includes('regrettable change'), { message: 'change propagates' });

    const notices = [];
    b.on('restored', (notice) => notices.push(notice));
    const restore = await owner.post(`/api/documents/${doc.id}/versions/${good.body.version.id}/restore`);
    expect(restore.status).toBe(200);
    expect(restore.body.preRestore.kind).toBe('pre-restore');
    expect(restore.body.restored.kind).toBe('restore');

    await waitFor(() => bodyText(a.doc) === 'good version' && bodyText(b.doc) === 'good version', { message: 'everyone sees the restore' });
    await waitFor(() => notices.length === 1, { message: 'restore notice' });
    expect(notices[0].by.name).toBe('Owner');
    expect(await versionText(owner, doc.id, restore.body.preRestore.id)).toBe('good version\nregrettable change');

    // Undo the restore by restoring the safety copy.
    await owner.post(`/api/documents/${doc.id}/versions/${restore.body.preRestore.id}/restore`);
    await waitFor(() => bodyText(b.doc) === 'good version\nregrettable change', { message: 'undo restore' });
    expect(bodyText(a.doc)).toBe(bodyText(b.doc));
  });

  it('merges an offline collaborator’s new paragraphs after a restore instead of dropping them', async () => {
    const doc = await createDocument(owner, workspace.id);
    const indexedDB = new IDBFactory();
    const store = await openUserStore(editor.user.id, { indexedDB });
    cleanup.push(() => store.close());
    const network = manualNetwork(true);
    const offline = open(editor, doc.id, { storage: store.forSession(), network });
    const live = open(owner, doc.id);
    await Promise.all([offline.start(), live.start()]);
    await Promise.all([waitForSynced(offline), waitForSynced(live)]);
    appendParagraph(live.doc, 'baseline');
    await waitForDurable(live);
    const base = await owner.post(`/api/documents/${doc.id}/versions`, { label: 'Baseline' });
    appendParagraph(live.doc, 'later edit');
    await waitForDurable(live);
    await waitFor(() => bodyText(offline.doc).includes('later edit'), { message: 'offline device caught up' });

    network.set(false);
    appendParagraph(offline.doc, 'written offline');
    await owner.post(`/api/documents/${doc.id}/versions/${base.body.version.id}/restore`);
    await waitFor(() => bodyText(live.doc) === 'baseline', { message: 'restore applied' });

    network.set(true);
    await waitForDurable(offline);
    await waitFor(() => bodyText(live.doc).includes('written offline'), { message: 'offline paragraph merged' });
    expect(bodyText(live.doc)).toBe(bodyText(offline.doc));
    expect(bodyText(live.doc)).not.toContain('later edit');
  });
});

describe('recovered offline copies', () => {
  it('stores an uploaded pre-merge copy as a version for editors only', async () => {
    const doc = await createDocument(owner, workspace.id);
    const scratch = new Y.Doc();
    appendParagraph(scratch, 'rescued words');
    const state = Buffer.from(Y.encodeStateAsUpdate(scratch));
    const upload = (client) =>
      client.agent
        .post(`/api/documents/${doc.id}/versions/recovered`)
        .set('Origin', 'http://localhost:5173')
        .set('X-SyncSpace-Request', '1')
        .set('Content-Type', 'application/octet-stream')
        .send(state);

    const res = await upload(editor);
    expect(res.status).toBe(201);
    expect(res.body.version.kind).toBe('recovered');
    expect(await versionText(owner, doc.id, res.body.version.id)).toBe('rescued words');
    expect((await upload(viewer)).status).toBe(403);
    expect((await upload(outsider)).status).toBe(404);

    const garbage = await editor.agent
      .post(`/api/documents/${doc.id}/versions/recovered`)
      .set('Origin', 'http://localhost:5173')
      .set('X-SyncSpace-Request', '1')
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from([1, 2, 3, 4, 5]));
    expect(garbage.status).toBe(400);
  });
});
