import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ConfigError, readConfig } from '../src/config.js';
import { securityHeaders } from '../src/http/security.js';

const BASE = { NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:1/x', APP_ORIGINS: 'http://localhost:5173' };

async function policy(config) {
  const app = express();
  app.use(securityHeaders({ allowedOrigins: config.allowedOrigins, httpsOnly: false, splineOrigins: config.splineOrigins }));
  app.get('/', (req, res) => res.send('ok'));
  const response = await request(app).get('/');
  return Object.fromEntries(
    response.headers['content-security-policy'].split(';').map((directive) => {
      const [name, ...values] = directive.trim().split(/\s+/);
      return [name, values];
    }),
  );
}

describe('content security policy', () => {
  it('allows only this origin, and no WebAssembly compilation, by default', async () => {
    const config = readConfig(BASE);
    expect(config.splineOrigins).toEqual([]);
    const csp = await policy(config);
    expect(csp['script-src']).toEqual(["'self'"]);
    expect(csp['connect-src']).toEqual(["'self'", 'ws://localhost:5173']);
    expect(csp['img-src']).toEqual(["'self'", 'data:', 'blob:']);
  });

  it('opens exactly the configured Spline hosts when SPLINE_ORIGINS is set', async () => {
    const config = readConfig({ ...BASE, SPLINE_ORIGINS: 'https://prod.spline.design, https://cdn.spline.design' });
    expect(config.splineOrigins).toEqual(['https://prod.spline.design', 'https://cdn.spline.design']);
    const csp = await policy(config);
    expect(csp['script-src']).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(csp['connect-src']).toEqual(["'self'", 'ws://localhost:5173', 'https://prod.spline.design', 'https://cdn.spline.design']);
    expect(csp['font-src']).toContain('https://cdn.spline.design');
    expect(csp['script-src']).not.toContain("'unsafe-eval'");
  });

  it('rejects anything but https origins', () => {
    expect(() => readConfig({ ...BASE, SPLINE_ORIGINS: 'http://prod.spline.design' })).toThrow(ConfigError);
    expect(() => readConfig({ ...BASE, SPLINE_ORIGINS: 'https://prod.spline.design/path' })).toThrow(ConfigError);
    expect(() => readConfig({ ...BASE, SPLINE_ORIGINS: "'unsafe-inline'" })).toThrow(ConfigError);
  });
});
