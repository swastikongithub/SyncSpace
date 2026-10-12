import { expect, test } from '@playwright/test';
import { createWorkspace, editor, expectStatus, inviteLink, newDocument, person, register } from './helpers.js';

test('outsiders cannot open a workspace or document by URL, and viewers cannot edit', async ({ browser }) => {
  const owner = person('Owner');
  const viewer = person('Viewer');
  const outsider = person('Outsider');
  const ownerPage = await (await browser.newContext()).newPage();
  const viewerPage = await (await browser.newContext()).newPage();
  const outsiderPage = await (await browser.newContext()).newPage();

  await register(viewerPage, viewer);
  await register(outsiderPage, outsider);
  await register(ownerPage, owner);
  await createWorkspace(ownerPage, 'Private group');
  await newDocument(ownerPage);
  await ownerPage.keyboard.type('Confidential');
  await expectStatus(ownerPage, 'Stored on server');
  const docUrl = ownerPage.url();
  const workspaceUrl = docUrl.replace(/\/d\/.*$/, '');

  // An outsider who guesses the URL sees nothing of the content.
  await outsiderPage.goto(docUrl);
  await expect(outsiderPage.getByRole('heading', { name: 'Workspace not found' })).toBeVisible();
  await expect(outsiderPage.getByText('Confidential')).toHaveCount(0);

  // A viewer can read but not edit.
  const link = await inviteLink(ownerPage, workspaceUrl, viewer.email, 'viewer');
  await viewerPage.goto(link);
  await viewerPage.getByRole('button', { name: 'Join as viewer' }).click();
  await viewerPage.goto(docUrl);
  await expect(editor(viewerPage)).toContainText('Confidential');
  await expect(editor(viewerPage)).toHaveAttribute('contenteditable', 'false');
  await expect(viewerPage.getByText('You’re a viewer in this workspace')).toBeVisible();
  await expectStatus(viewerPage, 'Up to date');

  // An invitation link only works for the address it was sent to.
  const another = await inviteLink(ownerPage, workspaceUrl, 'someone-else@e2e.syncspace.test', 'editor');
  await outsiderPage.goto(another);
  await expect(outsiderPage.getByText(/This invitation is for someone-else@e2e\.syncspace\.test/)).toBeVisible();
  await expect(outsiderPage.getByRole('button', { name: /^Join as/ })).toHaveCount(0);
});
