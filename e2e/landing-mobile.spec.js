import { expect, test } from '@playwright/test';

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test('the landing page fits a phone, with the stage pinned above the story', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('banner').getByRole('link', { name: 'Create an account' })).toBeVisible();
  expect(await overflow(page)).toBe(0);

  await page.evaluate(() => document.querySelector('#offline').scrollIntoView({ block: 'start' }));
  const band = page.locator('.ss-story-stage');
  await expect(band).toBeInViewport();
  const box = await band.boundingBox();
  const header = await page.getByRole('banner').boundingBox();
  expect(Math.abs(box.y - (header.y + header.height))).toBeLessThan(2);
  await expect(page.getByRole('heading', { name: 'Lose the connection. Keep the sentence.' })).toBeInViewport();

  for (const width of [360, 320]) {
    await page.setViewportSize({ width, height: 740 });
    await page.goto('/');
    expect(await overflow(page), `horizontal overflow at ${width}px`).toBe(0);
  }
});
