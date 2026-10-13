#!/usr/bin/env node
// Measures cold loads of the landing page from the production build, as served by the real server.
//   npm run build && node scripts/measure-landing.js [--runs 3] [--out docs/measurements/landing.json]
// Each run uses a fresh browser context with the cache disabled, so nothing is reused between
// runs (the service worker is new each time too). Two network profiles: unthrottled loopback, and
// a "slow 4G" profile (1.6 Mbit/s down, 750 kbit/s up, 150 ms latency) with the CPU slowed 4x.
// Desktop (1440x900) and Pixel 7 emulation. Records first contentful paint, largest contentful
// paint, when the 3D renderer reported ready, when its first frame was drawn, and bytes transferred.
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname } from 'node:path';
import { chromium, devices } from '@playwright/test';
import { MongoMemoryServer } from 'mongodb-memory-server';
import pino from 'pino';
import { readConfig } from '../apps/server/src/config.js';
import { connectDatabase, disconnectDatabase } from '../apps/server/src/db.js';
import { startServer } from '../apps/server/src/server.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, index, all) => (value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1]]] : pairs), []),
);
const RUNS = Number(args.runs ?? 3);
const OUT = args.out ?? 'docs/measurements/landing.json';

const PROFILES = {
  unthrottled: { network: null, cpu: 1 },
  'slow-4g-cpu4x': {
    network: { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
    cpu: 4,
  },
};
const DEVICES = { desktop: { viewport: { width: 1440, height: 900 } }, 'pixel-7': devices['Pixel 7'] };

const median = (values) => {
  const sorted = values.filter((value) => value != null).sort((a, b) => a - b);
  return sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)]) : null;
};

const mongod = await MongoMemoryServer.create();
const uri = new URL(mongod.getUri());
uri.pathname = '/syncspace_measure_landing';
const logger = pino({ level: 'silent' });
await connectDatabase({ uri: uri.toString(), logger, maxAttempts: 3, retryMs: 100 });
const config = { ...readConfig({ NODE_ENV: 'test', MONGODB_URI: uri.toString(), APP_ORIGINS: 'http://localhost:4330', SERVE_WEB: 'true' }), port: 4330 };
const server = await startServer({ config, logger, port: 4330 });
const url = 'http://localhost:4330/';

// Channel 'chromium' (full Chromium, new headless) exposes WebGPU where the machine has an adapter.
const browser = await chromium.launch({ channel: 'chromium' });
const runs = [];
let adapter = null;

for (const [deviceName, contextOptions] of Object.entries(DEVICES)) {
  for (const [profileName, profile] of Object.entries(PROFILES)) {
    for (let run = 0; run < RUNS; run += 1) {
      const context = await browser.newContext(contextOptions);
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      if (profile.network) await cdp.send('Network.emulateNetworkConditions', profile.network);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
      const urls = new Map();
      let bytes = 0;
      let bytes3d = 0;
      cdp.on('Network.requestWillBeSent', (event) => urls.set(event.requestId, event.request.url));
      cdp.on('Network.loadingFinished', (event) => {
        bytes += event.encodedDataLength;
        if ((urls.get(event.requestId) ?? '').includes('/assets/3d/')) bytes3d += event.encodedDataLength;
      });
      await page.addInitScript(() => {
        window.__landing = {};
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) window.__landing.lcp = entry.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        const watch = () => {
          const stage = document.querySelector('.ss-stage');
          if (!stage) return requestAnimationFrame(watch);
          new MutationObserver(() => {
            if (/^(webgpu|webgl2)$/.test(stage.dataset.renderer ?? '') && !window.__landing.ready) window.__landing.ready = performance.now();
            if (stage.dataset.frames && !window.__landing.firstFrame) window.__landing.firstFrame = performance.now();
          }).observe(stage, { attributes: true });
        };
        watch();
      });
      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__landing.firstFrame || document.querySelector('.ss-stage')?.dataset.renderer === 'poster', null, {
        timeout: 120_000,
      });
      await page.waitForTimeout(1000);
      adapter ??= await page.evaluate(async () => {
        const found = await navigator.gpu?.requestAdapter();
        return found ? [found.info?.vendor, found.info?.architecture, found.info?.description].filter(Boolean).join(' ') : null;
      });
      const result = await page.evaluate(() => ({
        fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null,
        lcp: window.__landing.lcp ?? null,
        rendererReady: window.__landing.ready ?? null,
        firstFrame: window.__landing.firstFrame ?? null,
        renderer: document.querySelector('.ss-stage')?.dataset.renderer,
      }));
      runs.push({ device: deviceName, profile: profileName, run, ...result, transferKiB: Math.round(bytes / 1024), transfer3dKiB: Math.round(bytes3d / 1024) });
      await context.close();
    }
  }
}

const summary = {};
for (const deviceName of Object.keys(DEVICES)) {
  for (const profileName of Object.keys(PROFILES)) {
    const subset = runs.filter((run) => run.device === deviceName && run.profile === profileName);
    summary[`${deviceName} / ${profileName}`] = {
      medianMs: {
        firstContentfulPaint: median(subset.map((run) => run.fcp)),
        largestContentfulPaint: median(subset.map((run) => run.lcp)),
        rendererReady: median(subset.map((run) => run.rendererReady)),
        firstFrame: median(subset.map((run) => run.firstFrame)),
      },
      renderer: [...new Set(subset.map((run) => run.renderer))].join(', '),
      transferKiB: median(subset.map((run) => run.transferKiB)),
      transfer3dKiB: median(subset.map((run) => run.transfer3dKiB)),
    };
  }
}

const report = {
  measuredAt: new Date().toISOString(),
  environment: {
    os: `${os.type()} ${os.release()}`,
    cpu: os.cpus()[0]?.model,
    cores: os.cpus().length,
    node: process.version,
    browser: `Chromium ${browser.version()}`,
    gpuAdapter: adapter,
    server: 'SyncSpace API serving apps/web/dist over loopback (precompressed Brotli)',
  },
  method:
    'Cold loads, cache disabled, fresh context per run. FCP/LCP from the Paint and LCP APIs; renderer ready and first frame from the stage element (data-renderer, data-frames).',
  summary,
  runs: runs.map((run) => Object.fromEntries(Object.entries(run).map(([key, value]) => [key, typeof value === 'number' ? Math.round(value) : value]))),
};

await browser.close();
await server.close({ graceful: false });
await disconnectDatabase();
await mongod.stop();
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
console.log(`Written to ${OUT}`);
