import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { person, register } from './helpers.js';

const stage = (page) => page.locator('.ss-stage');

/** Waits for the light table to render with WebGPU or WebGL 2 (the CI browser has no GPU adapter). */
async function expectRenderer(page) {
  await expect(stage(page)).toHaveAttribute('data-renderer', /^(webgpu|webgl2)$/, { timeout: 30_000 });
}

const frames = (page) => stage(page).evaluate((element) => Number(element.dataset.frames ?? 0));

/**
 * The frame count stops changing: nothing is animating, so nothing is drawn. Pages opened with
 * ?stage-debug record why the last frame was drawn; a failure reports it.
 */
async function expectSettled(page, timeout = 40_000) {
  const deadline = Date.now() + timeout;
  let delta;
  do {
    const before = await frames(page);
    await page.waitForTimeout(700);
    delta = (await frames(page)) - before;
    if (delta === 0) return;
  } while (Date.now() < deadline);
  const debug = await stage(page).getAttribute('data-debug');
  throw new Error(`The stage kept drawing (${delta} frames in 700 ms). Last frame: ${debug}`);
}

// Software rendering (SwiftShader on CI runners without a GPU) makes the 3D tests slow.
const SLOW = 150_000;

test('visitors get the landing page at /, with working calls to action', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/SyncSpace/);
  await expect(page.getByRole('heading', { level: 1, name: 'Write together, even when the connection drops.' })).toBeVisible();

  await page.getByRole('main').getByRole('link', { name: 'Create an account' }).first().click();
  await expect(page).toHaveURL(/\/register$/);
  await page.goBack();
  await page.getByRole('main').getByRole('link', { name: 'Sign in' }).first().click();
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  await page.goto('/');
  await page.getByRole('link', { name: 'Try it without an account' }).click();
  await expect(page.getByRole('heading', { name: 'Try it: one page, three copies.' })).toBeInViewport();
});

test('people signed in on this device still go straight to their workspaces', async ({ page }) => {
  await register(page, person('Returning'));
  await page.goto('/');
  await expect(page).toHaveURL(/\/w(\/|$)/);
  await expect(page.getByRole('heading', { name: 'Write together, even when the connection drops.' })).toHaveCount(0);
});

test('the light table renders, follows the story, and draws nothing while idle or off screen', async ({ page }) => {
  test.setTimeout(SLOW);
  await page.goto('/?stage-debug');
  await expectRenderer(page);
  await expect(page.locator('.ss-stage-canvas canvas')).toBeVisible();
  await expectSettled(page);

  // The hero control pulls your copy out of register: the scene animates, then settles again.
  const pull = page.getByRole('button', { name: 'Pull my copy out of register' });
  const before = await frames(page);
  await pull.click();
  await expect(page.getByRole('button', { name: 'Let my copy sync back' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => frames(page)).toBeGreaterThan(before);
  await expectSettled(page);

  // Scrolling to a chapter changes what the stage shows (and says).
  await page.locator('#offline').scrollIntoViewIfNeeded();
  await page.evaluate(() => document.querySelector('#offline').scrollIntoView({ block: 'start' }));
  await expect(page.locator('.ss-stage-caption')).toContainText('Your copy is offline');
  await expectSettled(page);

  // Off screen: no frames at all.
  await page.locator('footer').scrollIntoViewIfNeeded();
  await expect(stage(page)).toHaveAttribute('data-active', 'false');
  const offscreen = await frames(page);
  await page.waitForTimeout(1500);
  expect(await frames(page)).toBe(offscreen);
});

test('the demo’s copies merge, and the stage draws them', async ({ page }) => {
  test.setTimeout(SLOW);
  await page.goto('/?stage-debug#try');
  await expectRenderer(page);
  await expect(page.locator('.ss-stage-caption')).toContainText('The demo’s three copies');

  await page.getByRole('button', { name: 'Take your laptop offline' }).click();
  await page.locator('#demo-laptop').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Bring the spare thermometer.');
  await page.locator('#demo-phone').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Room 214.');
  await expect(page.getByText(/Offline: \d+ edits? only here/)).toBeVisible();
  await page.getByRole('button', { name: 'Reconnect your laptop' }).click();

  const values = () => page.evaluate(() => ['laptop', 'server', 'phone'].map((key) => document.querySelector(`#demo-${key}`).value));
  await expect.poll(async () => new Set(await values()).size).toBe(1);
  const [merged] = await values();
  expect(merged).toContain('Bring the spare thermometer.');
  expect(merged).toContain('Room 214.');
  await expectSettled(page);
});

test('without WebGPU or WebGL the page shows the still drawing and stays fully usable', async ({ page }) => {
  await page.addInitScript(() => {
    delete Navigator.prototype.gpu;
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContext(type, ...rest) {
      return /webgl|webgpu/.test(type) ? null : original.call(this, type, ...rest);
    };
  });
  await page.goto('/');
  await expect(stage(page)).toHaveAttribute('data-renderer', 'poster');
  await expect(page.getByText('This browser has neither WebGPU nor WebGL 2, so the table is drawn as a still.')).toBeVisible();
  await expect(page.locator('.ss-poster svg')).toBeVisible();
  await expect(page.locator('.ss-stage canvas')).toHaveCount(0);
  await page.getByRole('main').getByRole('link', { name: 'Create an account' }).first().click();
  await expect(page).toHaveURL(/\/register$/);
});

test('?stage=poster turns the 3D table off for the visit', async ({ page }) => {
  await page.goto('/?stage=poster');
  await expect(stage(page)).toHaveAttribute('data-renderer', 'poster');
  await page.waitForTimeout(1000);
  await expect(page.locator('.ss-stage canvas')).toHaveCount(0);
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('the headline does not animate and the table jumps straight to each state', async ({ page }) => {
    test.setTimeout(SLOW);
    await page.goto('/?stage-debug');
    await expect(page.locator('.ss-h1-plate')).toBeHidden();
    await expectRenderer(page);
    await expectSettled(page);
    const before = await frames(page);
    await page.evaluate(() => document.querySelector('#offline').scrollIntoView({ block: 'start' }));
    await expect(page.locator('.ss-stage-caption')).toContainText('Your copy is offline');
    await page.waitForTimeout(1200);
    // One or two frames to show the new state, not an animation.
    expect((await frames(page)) - before).toBeLessThanOrEqual(4);
  });
});

test('the landing page has no serious WCAG 2.2 AA violations (axe)', async ({ page }) => {
  await page.goto('/');
  await expectRenderer(page);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact));
  const summary = serious.map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(' ')).slice(0, 3).join(', ')})`);
  expect(summary).toEqual([]);
});
