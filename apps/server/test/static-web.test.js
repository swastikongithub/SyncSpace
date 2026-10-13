import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer } from './helpers.js';

// The web build writes .br and .gz copies of its text assets (apps/web/scripts/precompress.js);
// the server sends them to clients that accept them.
const SCRIPT = `console.log(${JSON.stringify('the landing page '.repeat(200))});`;
const HTML = `<!doctype html><title>SyncSpace</title>${'<p>shell</p>'.repeat(100)}`;

let dist;
let harness;
const get = (path, encoding) => {
  const call = request(harness.url).get(path);
  return encoding === undefined ? call.set('Accept-Encoding', 'identity') : call.set('Accept-Encoding', encoding);
};

beforeAll(async () => {
  dist = mkdtempSync(join(tmpdir(), 'syncspace-dist-'));
  mkdirSync(join(dist, 'assets'));
  for (const [path, body] of [
    ['index.html', HTML],
    ['assets/app-abc123.js', SCRIPT],
  ]) {
    writeFileSync(join(dist, path), body);
    writeFileSync(join(dist, `${path}.br`), brotliCompressSync(body));
    writeFileSync(join(dist, `${path}.gz`), gzipSync(body));
  }
  writeFileSync(join(dist, 'assets/plain-def456.js'), 'console.log(1);');
  harness = await startTestServer({ configOverrides: { serveWeb: true, webDistDir: dist } });
});

afterAll(async () => {
  await harness?.stop();
  rmSync(dist, { recursive: true, force: true });
});

describe('serving the web build', () => {
  it('sends the Brotli copy to clients that accept it, with the original type and caching', async () => {
    const response = await get('/assets/app-abc123.js', 'gzip, deflate, br');
    expect(response.status).toBe(200);
    expect(response.headers['content-encoding']).toBe('br');
    expect(response.headers['content-type']).toMatch(/^text\/javascript|^application\/javascript/);
    expect(response.headers.vary).toMatch(/Accept-Encoding/i);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(response.text).toBe(SCRIPT);
  });

  it('falls back to gzip, then to the file itself', async () => {
    const gzip = await get('/assets/app-abc123.js', 'gzip');
    expect(gzip.headers['content-encoding']).toBe('gzip');
    expect(gzip.text).toBe(SCRIPT);

    const refused = await get('/assets/app-abc123.js', 'br;q=0, gzip;q=0');
    expect(refused.headers['content-encoding']).toBeUndefined();
    expect(refused.text).toBe(SCRIPT);

    const identity = await get('/assets/app-abc123.js');
    expect(identity.headers['content-encoding']).toBeUndefined();
    expect(identity.text).toBe(SCRIPT);
  });

  it('serves files without compressed copies as they are', async () => {
    const response = await get('/assets/plain-def456.js', 'br');
    expect(response.status).toBe(200);
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.text).toBe('console.log(1);');
  });

  it('compresses the app shell for client-side routes, which must not be cached', async () => {
    const response = await get('/w/some-workspace', 'br');
    expect(response.status).toBe(200);
    expect(response.headers['content-encoding']).toBe('br');
    expect(response.headers['content-type']).toMatch(/^text\/html/);
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.text).toBe(HTML);
  });

  it('never serves anything outside the build directory', async () => {
    const response = await get('/assets/..%2F..%2F..%2Fpackage.json', 'br');
    expect(response.text).toBe(HTML); // the app shell, not a file from elsewhere
    expect((await get('/%2e%2e/%2e%2e/package.json', 'br')).text).toBe(HTML);
  });

  it('leaves the API alone', async () => {
    const response = await get('/api/health', 'br');
    expect(response.status).toBe(200);
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.body.status).toBe('ok');
  });
});
