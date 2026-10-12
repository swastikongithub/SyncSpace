import { expect, test } from '@playwright/test';
import { createWorkspace, editor, expectSavedOnDevice, expectStatus, newDocument, person, register, typeAtEnd } from './helpers.js';

test('a document kept on this device reopens offline after a full page reload, stays editable, and syncs later', async ({ page, context }) => {
  await register(page, person('Field'));
  await createWorkspace(page, 'Field trip');
  await newDocument(page);
  await page.keyboard.type('Field notes');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Collected samples at the river.');
  await expectStatus(page, 'Stored on server');

  // The service worker takes control after the first reload; from then on it serves the app shell.
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 15_000 });
  await expect(editor(page)).toContainText('Collected samples');

  await context.setOffline(true);
  await page.reload();
  await expect(editor(page)).toContainText('Collected samples at the river.');
  await expect(page.getByRole('status').filter({ hasText: 'You’re offline.' })).toBeVisible();

  await typeAtEnd(page, ' Water was cold.');
  await expect(editor(page)).toContainText('Water was cold.');
  await expectStatus(page, 'Saved on this device only');
  await expectSavedOnDevice(page);

  // A document never opened on this device is reported honestly.
  const workspaceUrl = page.url().replace(/\/d\/.*$/, '');
  await page.goto(`${workspaceUrl}/d/0123456789abcdef01234567`);
  await expect(page.getByRole('heading', { name: /isn’t on this device yet|isn’t available/ })).toBeVisible();
  await page.goBack();
  await expect(editor(page)).toContainText('Water was cold.');

  await context.setOffline(false);
  await expectStatus(page, 'Stored on server');
  await page.reload();
  await expect(editor(page)).toContainText('Water was cold.');
});

test('signing out while offline keeps unsent work on the device and says the server session ends later', async ({ page, context }) => {
  const account = person('Traveller');
  await register(page, account);
  await createWorkspace(page, 'Travel');
  await newDocument(page);
  await page.keyboard.type('Itinerary');
  await expectStatus(page, 'Stored on server');
  const docUrl = page.url();

  await context.setOffline(true);
  await typeAtEnd(page, ' unsent');
  await expectStatus(page, 'Saved on this device only');

  await page.getByRole('button', { name: `Account: ${account.name}` }).click();
  await page.getByRole('menuitem', { name: 'Sign out…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign out' });
  await expect(dialog.getByText('Some changes haven’t reached the server')).toBeVisible();
  await expect(dialog.getByText(/Itinerary.*edit/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/\/signin/);
  await expect(page.getByText('Signed out on this device')).toBeVisible();
  await expect(page.getByText(/the server hasn’t ended your session yet/)).toBeVisible();

  // Back online and signed in again on the same device: the kept edits are sent in the
  // background, without anyone opening the document.
  await context.setOffline(false);
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/w\//);
  await expect(page.getByText(/unsent edits? on this device/)).toHaveCount(0, { timeout: 20_000 });

  // A different browser (no local copy) sees the edit, proving it reached the server.
  const other = await (await page.context().browser().newContext()).newPage();
  await other.goto('/signin');
  await other.getByLabel('Email').fill(account.email);
  await other.getByLabel('Password').fill(account.password);
  await other.getByRole('button', { name: 'Sign in' }).click();
  await other.waitForURL(/\/w(\/|$)/);
  await other.goto(docUrl);
  await expect(editor(other)).toContainText('Itinerary unsent');
});
