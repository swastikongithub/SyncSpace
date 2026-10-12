import { expect, test } from '@playwright/test';
import { createWorkspace, documentText, editor, expectStatus, inviteLink, newDocument, person, register, typeAtEnd } from './helpers.js';

test('two people edit together, one goes offline, and every copy converges and persists', async ({ browser }) => {
  const ana = person('Ana');
  const ben = person('Ben');
  const anaContext = await browser.newContext();
  const benContext = await browser.newContext();
  const anaPage = await anaContext.newPage();
  const benPage = await benContext.newPage();

  await register(benPage, ben);
  await register(anaPage, ana);
  await createWorkspace(anaPage, 'E2E study group');
  await newDocument(anaPage);
  await anaPage.keyboard.type('Shared plan');
  await anaPage.keyboard.press('Enter');
  await anaPage.keyboard.type('Ana writes the first line.');
  await expectStatus(anaPage, 'Stored on server');
  const docUrl = anaPage.url();
  const workspaceUrl = docUrl.replace(/\/d\/.*$/, '');

  // Ben joins through a real invitation link.
  const link = await inviteLink(anaPage, workspaceUrl, ben.email, 'editor');
  await benPage.goto(link);
  await benPage.getByRole('button', { name: 'Join as editor' }).click();
  await benPage.waitForURL(workspaceUrl);

  await anaPage.goto(docUrl);
  await benPage.goto(docUrl);
  await expect(editor(benPage)).toContainText('Ana writes the first line.');

  // Presence: each sees the other in the copies panel.
  await expect(anaPage.getByRole('region', { name: 'Here now' }).getByText(ben.name)).toBeVisible();
  await expect(benPage.getByRole('region', { name: 'Here now' }).getByText(ana.name)).toBeVisible();

  // Concurrent edits from both.
  await typeAtEnd(anaPage, ' Ana adds a second sentence.');
  await typeAtEnd(benPage, ' Ben adds his own.');
  for (const page of [anaPage, benPage]) {
    await expect(editor(page)).toContainText('Ana adds a second sentence.');
    await expect(editor(page)).toContainText('Ben adds his own.');
  }

  // Ben loses his connection and keeps writing; Ana keeps writing too.
  await benContext.setOffline(true);
  await typeAtEnd(benPage, ' Ben wrote this offline.');
  await expectStatus(benPage, 'Saved on this device only');
  await expect(benPage.getByRole('status').filter({ hasText: 'You’re offline.' })).toBeVisible();
  await typeAtEnd(anaPage, ' Ana wrote this meanwhile.');
  await expectStatus(anaPage, 'Stored on server');
  await expect(editor(anaPage)).not.toContainText('Ben wrote this offline.');

  // Reconnect: both copies merge and every edit is stored.
  await benContext.setOffline(false);
  await expectStatus(benPage, 'Stored on server');
  await expect(editor(anaPage)).toContainText('Ben wrote this offline.');
  await expect(editor(benPage)).toContainText('Ana wrote this meanwhile.');
  await expect.poll(() => documentText(anaPage)).toBe(await documentText(benPage));

  // Reloading reads everything back from storage.
  await benPage.reload();
  await expect(editor(benPage)).toContainText('Ben wrote this offline.');
  await expect(editor(benPage)).toContainText('Ana wrote this meanwhile.');

  await anaContext.close();
  await benContext.close();
});
