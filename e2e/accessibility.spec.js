import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { createWorkspace, expectStatus, newDocument, person, register } from './helpers.js';

async function audit(page, label) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
  const summary = serious.map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(' ')).slice(0, 3).join(', ')})`);
  expect(summary, `${label} has serious accessibility violations`).toEqual([]);
}

test('primary screens have no serious WCAG 2.2 AA violations (axe)', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await audit(page, 'Sign-in page');

  await register(page, person('Audit'));
  await audit(page, 'Workspace onboarding');
  await createWorkspace(page, 'Audited');
  await audit(page, 'Empty workspace');

  await newDocument(page);
  await page.keyboard.type('Accessible document');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Body text for the audit.');
  await expectStatus(page, 'Stored on server');
  await audit(page, 'Document page');

  await page.getByRole('button', { name: 'History' }).click();
  await audit(page, 'Document page with history');

  await page.goto(page.url().replace(/\/d\/.*$/, '/members'));
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
  await audit(page, 'Members page');
});
