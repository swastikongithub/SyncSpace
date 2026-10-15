import { expect } from '@playwright/test';

export const PASSWORD = 'a long e2e passphrase';
let counter = 0;

export function person(name) {
  counter += 1;
  const slug = `${name.toLowerCase()}-${Date.now().toString(36)}-${counter}`;
  return { name, email: `${slug}@e2e.syncspace.test`, password: PASSWORD };
}

export async function register(page, account) {
  await page.goto('/register');
  await page.getByLabel('Your name').fill(account.name);
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/w(\/|$|\?)/);
}

export async function createWorkspace(page, name) {
  await page.getByLabel('Workspace name').fill(name);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.waitForURL(/\/w\/[a-f0-9]{24}$/);
}

export async function newDocument(page) {
  await page.getByRole('button', { name: /New document|Start a document/ }).first().click();
  await page.waitForURL(/\/d\/[a-f0-9]{24}$/);
  await expect(page.locator('.ss-prose')).toBeVisible();
}

export function editor(page) {
  return page.locator('.ss-prose');
}

/** The document's text without collaborator caret labels (which differ per viewer). */
export function documentText(page) {
  return editor(page).evaluate((element) => {
    const copy = element.cloneNode(true);
    copy.querySelectorAll('.ss-caret').forEach((caret) => caret.remove());
    return copy.textContent;
  });
}

/** Places the caret at the end of the document body and types. */
export async function typeAtEnd(page, text) {
  await editor(page).locator('> :last-child').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(text);
}

export function statusButton(page) {
  return page.getByRole('button', { name: /^Sync status:/ });
}

/** This device has committed every edit to local storage (the copies panel's device line). */
export async function expectSavedOnDevice(page) {
  const copies = page.getByRole('region', { name: 'Copies of this document' });
  await expect(copies.getByText('Saved on this device', { exact: true })).toBeVisible();
}

export async function expectStatus(page, headline) {
  await expect(statusButton(page)).toHaveAccessibleName(new RegExp(`^Sync status: ${headline}\\.`), { timeout: 15_000 });
}

/** Creates an invite link as the current (owner) page and returns it. */
export async function inviteLink(page, workspaceUrl, email, role = 'editor') {
  await page.goto(`${workspaceUrl}/members`);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Role', { exact: true }).selectOption(role);
  await page.getByRole('button', { name: 'Create invite link' }).click();
  return page.getByLabel('Invite link').inputValue();
}
