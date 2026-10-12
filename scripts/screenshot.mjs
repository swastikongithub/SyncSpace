// Development helper: open pages in headless Chromium, report console errors, save screenshots.
// Usage: node scripts/screenshot.mjs <baseUrl> <outDir> [path ...]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const [base = 'http://localhost:5173', outDir = 'measurements/raw/screens', ...paths] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const viewports = [
  ['desktop', { width: 1440, height: 900 }],
  ['mobile', { width: 390, height: 844 }],
];
for (const [label, viewport] of viewports) {
  const page = await browser.newPage({ viewport });
  const problems = [];
  page.on('console', (message) => message.type() === 'error' && problems.push(message.text()));
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  for (const path of paths.length ? paths : ['/']) {
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const file = join(outDir, `${label}${path.replace(/[^a-z0-9]+/gi, '_')}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`${label} ${path} -> ${file} (title: ${await page.title()}, url: ${page.url()})`);
  }
  if (problems.length) console.log(`${label} console errors:\n  ${problems.join('\n  ')}`);
  await page.close();
}
await browser.close();
