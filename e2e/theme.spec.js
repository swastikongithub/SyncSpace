import { expect, test } from '@playwright/test';
import { createWorkspace, person, register } from './helpers.js';

const theme = (page) => page.evaluate(() => document.documentElement.dataset.theme);
const background = (page) => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);

test.use({ colorScheme: 'light' });

test('the theme switch overrides the system setting, persists, and can follow the system again', async ({ page }) => {
  await page.goto('/');
  expect(await theme(page)).toBe('light');
  const lightBackground = await background(page);

  await page.getByRole('button', { name: /^Theme:/ }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  expect(await theme(page)).toBe('dark');
  expect(await background(page)).not.toBe(lightBackground);
  await expect(page.getByRole('button', { name: 'Theme: Dark' })).toBeVisible();

  // Remembered, and applied before the app's scripts run (no light flash).
  await page.reload();
  expect(await theme(page)).toBe('dark');

  await page.getByRole('button', { name: /^Theme:/ }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemradio', { name: 'Match this device' }).click();
  expect(await theme(page)).toBe('light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(() => theme(page)).toBe('dark');
});

test('the switch is on the sign-in page, the workspace list and in the app header', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.getByRole('button', { name: /^Theme:/ })).toBeVisible();

  await register(page, person('Themer'));
  await page.getByRole('button', { name: /^Theme:/ }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  expect(await theme(page)).toBe('dark');

  await createWorkspace(page, 'Night shift');
  await page.getByRole('banner').getByRole('button', { name: /^Theme:/ }).click();
  await page.getByRole('menuitemradio', { name: 'Light' }).click();
  expect(await theme(page)).toBe('light');
});
