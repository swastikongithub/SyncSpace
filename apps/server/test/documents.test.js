import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DocUpdate } from '../src/collab/models.js';
import { DocVersion } from '../src/history/model.js';
import {
  addMember,
  createDocument,
  createWorkspace,
  openSession,
  registerUser,
  startTestServer,
  waitFor,
  waitForSynced,
} from './helpers.js';

let harness;
let owner;
let editor;
let workspace;
const cleanup = [];

beforeAll(async () => {
  harness = await startTestServer();
  [owner, editor] = await Promise.all([registerUser(harness, { name: 'Owner' }), registerUser(harness, { name: 'Editor' })]);
  workspace = await createWorkspace(owner);
  await addMember(owner, editor, workspace.id, 'editor');
});
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});
afterAll(async () => {
  await harness.stop();
});

describe('document lifecycle', () => {
  it('creates a document with its title stored in the collaborative content', async () => {
    const doc = await createDocument(owner, workspace.id, 'Lab report');
    expect(doc).toMatchObject({ title: 'Lab report', createdBy: { name: 'Owner' }, pinned: false, deletedAt: null });
    const s = openSession(harness, editor, doc.id);
    cleanup.push(() => s.destroy());
    await s.start();
    await waitForSynced(s);
    const titleNode = s.doc.getXmlFragment('default').get(0);
    expect(titleNode.nodeName).toBe('title');
    expect(titleNode.toString()).toContain('Lab report');
  });

  it('validates titles', async () => {
    const res = await owner.post(`/api/workspaces/${workspace.id}/documents`, { title: 'x'.repeat(201) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_failed');
  });

  it('renames through the CRDT so open editors see the new title', async () => {
    const doc = await createDocument(owner, workspace.id, 'Old name');
    const s = openSession(harness, editor, doc.id);
    cleanup.push(() => s.destroy());
    await s.start();
    await waitForSynced(s);
    const res = await owner.patch(`/api/documents/${doc.id}`, { title: 'New name' });
    expect(res.status).toBe(200);
    expect(res.body.document.title).toBe('New name');
    await waitFor(() => s.doc.getXmlFragment('default').get(0).toString().includes('New name'), { message: 'title in open editor' });
  });

  it('lists pinned documents first and supports the trash', async () => {
    const first = await createDocument(owner, workspace.id, 'Pinned one');
    await createDocument(owner, workspace.id, 'Newest');
    expect((await editor.patch(`/api/documents/${first.id}`, { pinned: true })).status).toBe(200);
    const list = await editor.get(`/api/workspaces/${workspace.id}/documents`);
    expect(list.body.documents[0].title).toBe('Pinned one');

    expect((await editor.post(`/api/documents/${first.id}/trash`)).status).toBe(200);
    const active = await editor.get(`/api/workspaces/${workspace.id}/documents`);
    expect(active.body.documents.map((d) => d.id)).not.toContain(first.id);
    const trash = await editor.get(`/api/workspaces/${workspace.id}/documents`).query({ trash: '1' });
    expect(trash.body.documents.map((d) => d.id)).toContain(first.id);

    expect((await editor.post(`/api/documents/${first.id}/untrash`)).status).toBe(200);
    const restored = await editor.get(`/api/workspaces/${workspace.id}/documents`);
    expect(restored.body.documents.map((d) => d.id)).toContain(first.id);
  });

  it('closes open editors when a document is trashed', async () => {
    const doc = await createDocument(owner, workspace.id);
    const s = openSession(harness, editor, doc.id);
    cleanup.push(() => s.destroy());
    await s.start();
    await waitForSynced(s);
    await owner.post(`/api/documents/${doc.id}/trash`);
    await waitFor(() => s.state.connection === 'blocked', { message: 'editor closed on trash' });
    expect(s.state.blocked.code).toBe(4410);
  });

  it('only deletes permanently from the trash, only for owners, and removes all stored data', async () => {
    const doc = await createDocument(owner, workspace.id, 'Temporary');
    await owner.post(`/api/documents/${doc.id}/versions`, { label: 'v1' });
    expect((await owner.delete(`/api/documents/${doc.id}`)).status).toBe(409);
    await owner.post(`/api/documents/${doc.id}/trash`);
    expect((await editor.delete(`/api/documents/${doc.id}`)).status).toBe(403);
    expect((await owner.delete(`/api/documents/${doc.id}`)).status).toBe(204);
    expect(await DocUpdate.countDocuments({ docId: doc.id })).toBe(0);
    expect(await DocVersion.countDocuments({ docId: doc.id })).toBe(0);
    expect((await owner.get(`/api/documents/${doc.id}`)).status).toBe(404);
  });

  it('records meaningful activity', async () => {
    const res = await owner.get(`/api/workspaces/${workspace.id}/activity`);
    expect(res.status).toBe(200);
    const types = res.body.activity.map((entry) => entry.type);
    expect(types).toEqual(expect.arrayContaining(['workspace.created', 'member.joined', 'document.created', 'document.renamed', 'document.trashed']));
  });
});
