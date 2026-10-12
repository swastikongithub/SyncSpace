import { expect, test } from '@playwright/test';
import { createWorkspace, expectStatus, newDocument, person, register, statusButton } from './helpers.js';

async function expectNoHorizontalScroll(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test('the phone layout keeps writing first and puts sync status one tap away', async ({ page }) => {
  await register(page, person('Phone'));
  await expectNoHorizontalScroll(page);
  await createWorkspace(page, 'Pocket notes');
  await expectNoHorizontalScroll(page);

  await newDocument(page);
  await page.keyboard.type('Bus notes');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Written on a phone.');
  await expectStatus(page, 'Stored on server');
  await expectNoHorizontalScroll(page);

  // The desktop document tray is not shown; the back control returns to the list.
  await expect(page.getByRole('navigation', { name: 'Documents in this workspace' })).toBeHidden();
  await statusButton(page).click();
  const panel = page.getByRole('dialog', { name: 'Sync status' });
  await expect(panel.getByText('Has all your changes')).toBeVisible();
  await panel.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('link', { name: 'Back to documents' }).click();
  await expect(page.getByRole('link', { name: /Bus notes/ })).toBeVisible();
  await expectNoHorizontalScroll(page);
});
