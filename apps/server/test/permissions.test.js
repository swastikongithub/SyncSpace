import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Invitation } from '../src/workspaces/models.js';
import { addMember, apiClient, createDocument, createWorkspace, registerUser, startTestServer } from './helpers.js';

let harness;
let owner;
let editor;
let viewer;
let outsider;
let workspace;
let doc;
let otherWorkspace;
let otherDoc;

beforeAll(async () => {
  harness = await startTestServer();
  [owner, editor, viewer, outsider] = await Promise.all([
    registerUser(harness, { name: 'Owner' }),
    registerUser(harness, { name: 'Editor' }),
    registerUser(harness, { name: 'Viewer' }),
    registerUser(harness, { name: 'Outsider' }),
  ]);
  workspace = await createWorkspace(owner, 'Physics study group');
  await addMember(owner, editor, workspace.id, 'editor');
  await addMember(owner, viewer, workspace.id, 'viewer');
  doc = await createDocument(owner, workspace.id, 'Thermodynamics');
  otherWorkspace = await createWorkspace(outsider, 'Outsider space');
  otherDoc = await createDocument(outsider, otherWorkspace.id, 'Private plans');
});
afterAll(async () => {
  await harness.stop();
});

describe('workspace access', () => {
  it('lists only the workspaces a user belongs to, with their role', async () => {
    const res = await viewer.get('/api/workspaces');
    expect(res.status).toBe(200);
    expect(res.body.workspaces.map((w) => [w.name, w.role])).toEqual([['Physics study group', 'viewer']]);
  });

  it('answers 404 (not 403) to non-members so workspace ids cannot be probed', async () => {
    for (const path of [
      `/api/workspaces/${workspace.id}`,
      `/api/workspaces/${workspace.id}/members`,
      `/api/workspaces/${workspace.id}/documents`,
      `/api/workspaces/${workspace.id}/activity`,
    ]) {
      const res = await outsider.get(path);
      expect(res.status, path).toBe(404);
      expect(res.body.error.code).toBe('workspace_not_found');
    }
    const malformed = await outsider.get('/api/workspaces/not-an-id');
    expect(malformed.status).toBe(404);
  });

  it('requires sign-in for every workspace route', async () => {
    const anonymous = apiClient(harness);
    expect((await anonymous.get('/api/workspaces')).status).toBe(401);
    expect((await anonymous.get(`/api/workspaces/${workspace.id}/documents`)).status).toBe(401);
    expect((await anonymous.get(`/api/documents/${doc.id}`)).status).toBe(401);
  });

  it('enforces roles on the server regardless of the client', async () => {
    expect((await viewer.post(`/api/workspaces/${workspace.id}/documents`, { title: 'Nope' })).status).toBe(403);
    expect((await editor.post(`/api/workspaces/${workspace.id}/documents`, { title: 'Allowed' })).status).toBe(201);
    expect((await editor.post(`/api/workspaces/${workspace.id}/invitations`, { email: 'x@example.test', role: 'editor' })).status).toBe(403);
    expect((await editor.patch(`/api/workspaces/${workspace.id}`, { name: 'Renamed' })).status).toBe(403);
    expect((await viewer.patch(`/api/documents/${doc.id}`, { title: 'Viewer rename' })).status).toBe(403);
    expect((await viewer.post(`/api/documents/${doc.id}/trash`)).status).toBe(403);
    expect((await editor.patch(`/api/workspaces/${workspace.id}/members/${viewer.user.id}`, { role: 'owner' })).status).toBe(403);
  });

  it('hides member emails from everyone except owners', async () => {
    const asViewer = await viewer.get(`/api/workspaces/${workspace.id}/members`);
    const others = asViewer.body.members.filter((member) => member.user.id !== viewer.user.id);
    expect(others.every((member) => member.user.email === undefined)).toBe(true);
    const asOwner = await owner.get(`/api/workspaces/${workspace.id}/members`);
    expect(asOwner.body.members.every((member) => typeof member.user.email === 'string')).toBe(true);
  });
});

describe('cross-workspace document isolation', () => {
  it('rejects every document operation on another workspace’s document id with 404', async () => {
    const id = otherDoc.id;
    const attempts = [
      ['get', `/api/documents/${id}`],
      ['patch', `/api/documents/${id}`, { title: 'Hijacked' }],
      ['post', `/api/documents/${id}/trash`],
      ['post', `/api/documents/${id}/untrash`],
      ['delete', `/api/documents/${id}`],
      ['get', `/api/documents/${id}/versions`],
      ['post', `/api/documents/${id}/versions`, { label: 'x' }],
    ];
    for (const [method, path, body] of attempts) {
      const res = await owner[method](path, body);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(res.body.error.code).toBe('document_not_found');
    }
  });

  it('cannot create documents in a workspace by guessing its id', async () => {
    const res = await owner.post(`/api/workspaces/${otherWorkspace.id}/documents`, { title: 'Injected' });
    expect(res.status).toBe(404);
  });

  it('search only returns documents from the user’s own workspaces', async () => {
    const mine = await owner.get('/api/search').query({ q: 'Thermo' });
    expect(mine.body.results.map((result) => result.title)).toContain('Thermodynamics');
    const theirs = await owner.get('/api/search').query({ q: 'Private' });
    expect(theirs.body.results).toEqual([]);
    const scoped = await owner.get('/api/search').query({ q: 'Private', workspaceId: otherWorkspace.id });
    expect(scoped.body.results).toEqual([]);
  });

  it('treats search input as text, not as a pattern', async () => {
    const res = await owner.get('/api/search').query({ q: '.*' });
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });
});

describe('invitations', () => {
  it('lets only the invited account accept, exactly once', async () => {
    const invitee = await registerUser(harness, { name: 'Invitee' });
    const someoneElse = await registerUser(harness, { name: 'Someone else' });
    const invite = await owner.post(`/api/workspaces/${workspace.id}/invitations`, { email: invitee.user.email, role: 'editor' });
    expect(invite.status).toBe(201);
    const { token } = invite.body;
    expect(await Invitation.countDocuments({ tokenHash: token })).toBe(0);

    const preview = await apiClient(harness).get(`/api/invitations/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body.invitation).toMatchObject({ workspaceName: 'Physics study group', role: 'editor', status: 'pending' });

    const wrong = await someoneElse.post(`/api/invitations/${token}/accept`);
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe('invitation_email_mismatch');
    expect((await someoneElse.get(`/api/workspaces/${workspace.id}`)).status).toBe(404);

    const right = await invitee.post(`/api/invitations/${token}/accept`);
    expect(right.status).toBe(200);
    expect(right.body.role).toBe('editor');
    expect((await invitee.get(`/api/workspaces/${workspace.id}`)).body.workspace.role).toBe('editor');

    const again = await invitee.post(`/api/invitations/${token}/accept`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('invitation_accepted');
  });

  it('refuses revoked, replaced and expired invitations', async () => {
    const invitee = await registerUser(harness);
    const first = await owner.post(`/api/workspaces/${workspace.id}/invitations`, { email: invitee.user.email, role: 'viewer' });
    const second = await owner.post(`/api/workspaces/${workspace.id}/invitations`, { email: invitee.user.email, role: 'viewer' });
    expect((await invitee.post(`/api/invitations/${first.body.token}/accept`)).body.error.code).toBe('invitation_revoked');

    await owner.delete(`/api/workspaces/${workspace.id}/invitations/${second.body.invitation.id}`);
    expect((await invitee.post(`/api/invitations/${second.body.token}/accept`)).body.error.code).toBe('invitation_revoked');

    const third = await owner.post(`/api/workspaces/${workspace.id}/invitations`, { email: invitee.user.email, role: 'viewer' });
    await Invitation.updateOne({ _id: third.body.invitation.id }, { expiresAt: new Date(Date.now() - 1000) });
    const expired = await invitee.post(`/api/invitations/${third.body.token}/accept`);
    expect(expired.status).toBe(409);
    expect(expired.body.error.code).toBe('invitation_expired');
    expect((await invitee.get(`/api/workspaces/${workspace.id}`)).status).toBe(404);
  });

  it('rejects unknown or malformed tokens with 404', async () => {
    const user = await registerUser(harness);
    expect((await user.post('/api/invitations/not-a-real-token-but-long-enough/accept')).status).toBe(404);
    expect((await apiClient(harness).get('/api/invitations/short')).status).toBe(404);
  });

  it('does not invite people who are already members', async () => {
    const res = await owner.post(`/api/workspaces/${workspace.id}/invitations`, { email: editor.user.email, role: 'viewer' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('already_member');
  });
});

describe('membership management', () => {
  it('never leaves a workspace without an owner', async () => {
    const solo = await createWorkspace(outsider, 'Solo');
    const demote = await outsider.patch(`/api/workspaces/${solo.id}/members/${outsider.user.id}`, { role: 'editor' });
    expect(demote.status).toBe(409);
    expect(demote.body.error.code).toBe('last_owner');
    const leave = await outsider.delete(`/api/workspaces/${solo.id}/members/${outsider.user.id}`);
    expect(leave.status).toBe(409);
  });

  it('removing a member revokes their access immediately', async () => {
    const temp = await registerUser(harness);
    await addMember(owner, temp, workspace.id, 'editor');
    expect((await temp.get(`/api/documents/${doc.id}`)).status).toBe(200);
    expect((await owner.delete(`/api/workspaces/${workspace.id}/members/${temp.user.id}`)).status).toBe(204);
    expect((await temp.get(`/api/documents/${doc.id}`)).status).toBe(404);
    expect((await temp.get(`/api/workspaces/${workspace.id}`)).status).toBe(404);
  });

  it('lets members leave on their own', async () => {
    const temp = await registerUser(harness);
    await addMember(owner, temp, workspace.id, 'viewer');
    expect((await temp.delete(`/api/workspaces/${workspace.id}/members/${temp.user.id}`)).status).toBe(204);
    expect((await temp.get(`/api/workspaces/${workspace.id}`)).status).toBe(404);
  });

  it('requires typing the name to delete a workspace, and deletes its documents', async () => {
    const doomed = await createWorkspace(outsider, 'Doomed');
    const doomedDoc = await createDocument(outsider, doomed.id, 'Gone soon');
    expect((await outsider.delete(`/api/workspaces/${doomed.id}`, { confirmName: 'doomed' })).status).toBe(400);
    expect((await outsider.delete(`/api/workspaces/${doomed.id}`, { confirmName: 'Doomed' })).status).toBe(204);
    expect((await outsider.get(`/api/documents/${doomedDoc.id}`)).status).toBe(404);
  });
});
