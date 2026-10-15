import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { person, register } from './helpers.js';

const table = (page) => page.locator('.ss-auth-table');
const canvas = (page) => page.locator('.ss-auth-canvas');
const frames = (page) => canvas(page).evaluate((element) => Number(element.dataset.frames ?? 0));

/** An account made through the API in its own cookie jar, so the page stays signed out. */
async function existingAccount(request, name) {
  const account = person(name);
  const response = await request.post('/api/auth/register', {
    data: { name: account.name, email: account.email, password: account.password },
    headers: { 'X-SyncSpace-Request': '1' },
  });
  expect(response.ok()).toBe(true);
  return account;
}

async function expectSettled(page, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let delta;
  do {
    const before = await frames(page);
    await page.waitForTimeout(600);
    delta = (await frames(page)) - before;
    if (delta === 0) return;
  } while (Date.now() < deadline);
  throw new Error(`The sign-in table kept drawing (${delta} frames in 600 ms).`);
}

async function audit(page, label) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
  expect(serious.map((violation) => `${violation.id}: ${violation.help}`), `${label} has serious accessibility violations`).toEqual([]);
}

test('the light table draws, then stops drawing once the copy has settled', async ({ page }) => {
  await page.goto('/signin');
  await expect(canvas(page)).toHaveAttribute('data-frames', /\d+/);
  await expectSettled(page);
  await expect(table(page)).toHaveAttribute('data-phase', 'idle');
  await expect(table(page)).toContainText('Not signed in on this device');

  // Typing moves the copy, and then it settles again.
  const before = await frames(page);
  await page.getByLabel('Email').fill('someone@example.org');
  await expect.poll(() => frames(page)).toBeGreaterThan(before);
  await expectSettled(page);
});

test('switching between the two forms keeps where you were going', async ({ page }) => {
  await page.goto('/signin?next=%2Fw');
  await expect(page.getByRole('heading', { name: 'Sign in to SyncSpace' })).toBeVisible();
  const account = page.getByRole('navigation', { name: 'Account' });
  await expect(account.getByRole('link', { name: 'Sign in' })).toHaveAttribute('aria-current', 'page');

  await account.getByRole('link', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/register\?next=%2Fw$/);
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await expect(account.getByRole('link', { name: 'Create account' })).toHaveAttribute('aria-current', 'page');
  await expect(table(page)).toContainText('No account on this device yet');
  await audit(page, 'Registration page');

  await account.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/signin\?next=%2Fw$/);
});

test('the password can be shown, and a new one shows how long it still has to be', async ({ page }) => {
  await page.goto('/register');
  const password = page.getByLabel('Password', { exact: true });
  await password.fill('short');
  await expect(password).toHaveAttribute('type', 'password');
  await expect(page.getByText('5 more characters.')).toBeVisible();

  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(password).toHaveAttribute('type', 'password');

  await password.fill('long enough now');
  await expect(page.getByText('Long enough.')).toBeVisible();
});

test('a wrong password is explained and the copy stays out of register', async ({ page, request }) => {
  const account = await existingAccount(request, 'Wrong');
  await page.goto('/signin');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill('not the right passphrase');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('That email and password do not match an account.');
  await expect(table(page)).toHaveAttribute('data-phase', 'error');
  await expect(page).toHaveURL(/\/signin$/);
});

test('signing in snaps the copy into register, then opens the app', async ({ page, request }) => {
  const account = await existingAccount(request, 'Snap');
  await page.goto('/signin');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Signed in' })).toBeVisible();
  await expect(table(page)).toHaveAttribute('data-phase', 'success');
  await expect(table(page)).toContainText('In step with the server');
  await page.waitForURL(/\/w(\/|$)/);
});

test('with reduced motion the app opens without waiting for the table', async ({ page, request }) => {
  const account = await existingAccount(request, 'Still');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/signin');
  await expectSettled(page);
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  const started = Date.now();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/w(\/|$)/);
  expect(Date.now() - started).toBeLessThan(5_000);
});

test('without WebGL 2 the table is a still drawing and accounts still work', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) {
      return /webgl/.test(type) ? null : original.call(this, type, ...rest);
    };
  });
  await page.goto('/signin');
  await expect(page.locator('.ss-auth-still')).toBeVisible();
  await expect(canvas(page)).toHaveCount(0);
  await register(page, person('NoGL'));
});
