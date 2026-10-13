import { existsSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import express from 'express';
import { pinoHttp } from 'pino-http';
import { authRoutes } from './auth/routes.js';
import { attachAuth } from './auth/middleware.js';
import { diagnosticsRoutes, healthRoute } from './diagnostics/routes.js';
import { documentRoutes, searchRoutes, workspaceDocumentRoutes } from './documents/routes.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { requestGuard, securityHeaders } from './http/security.js';
import { historyRoutes } from './history/routes.js';
import { invitationRoutes, workspaceRoutes } from './workspaces/routes.js';

export function createApp(ctx) {
  const { config, logger } = ctx;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      serializers: {
        req: (req) => ({ method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(securityHeaders({ allowedOrigins: config.allowedOrigins, httpsOnly: config.session.cookieSecure, splineOrigins: config.splineOrigins }));

  const api = express.Router();
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.use('/health', healthRoute());
  api.use(express.json({ limit: '64kb' }));
  api.use(requestGuard(config));
  api.use(attachAuth(ctx.authenticate));
  api.use('/auth', authRoutes(ctx));
  api.use('/workspaces/:workspaceId/documents', workspaceDocumentRoutes(ctx));
  api.use('/workspaces', workspaceRoutes(ctx));
  api.use('/invitations', invitationRoutes(ctx));
  api.use('/documents/:documentId/versions', historyRoutes(ctx));
  api.use('/documents', documentRoutes(ctx));
  api.use('/search', searchRoutes(ctx));
  api.use('/diagnostics', diagnosticsRoutes(ctx));
  api.use(notFoundHandler);
  app.use('/api', api);

  // In production the API also serves the built web app (single origin: simple cookies, no CORS).
  const indexHtml = join(config.webDistDir, 'index.html');
  if (config.serveWeb && existsSync(indexHtml)) {
    const cacheFor = (path) => (path.includes(`${join('assets', '')}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
    app.use(precompressed(config.webDistDir, cacheFor));
    app.use(
      express.static(config.webDistDir, {
        index: false,
        setHeaders(res, path) {
          res.set('Cache-Control', cacheFor(path));
        },
      }),
    );
    app.get(/^(?!\/api\/|\/ws\/).*/, (req, res) => {
      res.set('Cache-Control', 'no-cache');
      sendPrecompressed(req, res, indexHtml) || res.sendFile(indexHtml);
    });
  }

  app.use(errorHandler(logger));
  return app;
}

const ENCODINGS = [
  ['br', '.br'],
  ['gzip', '.gz'],
];

/** The content codings the client accepts (ignoring any it explicitly refuses with q=0). */
function acceptedEncodings(req) {
  return new Set(
    (req.get('accept-encoding') ?? '')
      .split(',')
      .map((part) => part.trim().split(';'))
      .filter(([, ...params]) => !params.some((param) => /^\s*q\s*=\s*0(\.0*)?\s*$/.test(param)))
      .map(([name]) => name.trim().toLowerCase()),
  );
}

/** Sends `file`'s Brotli or gzip copy (written by the web build) if the client accepts one. */
function sendPrecompressed(req, res, file) {
  const accepted = acceptedEncodings(req);
  res.vary('Accept-Encoding');
  for (const [encoding, suffix] of ENCODINGS) {
    if (!accepted.has(encoding) || !existsSync(file + suffix)) continue;
    res.set('Content-Encoding', encoding);
    res.type(extname(file));
    res.sendFile(file + suffix);
    return true;
  }
  return false;
}

/** Static files, served from their precompressed copies where possible. */
function precompressed(root, cacheFor) {
  const base = resolve(root);
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return next();
    }
    const file = resolve(base, `.${pathname}`);
    const inside = relative(base, file);
    if (!inside || inside.startsWith('..') || isAbsolute(inside) || !extname(file) || !existsSync(file)) return next();
    res.set('Cache-Control', cacheFor(file));
    return sendPrecompressed(req, res, file) ? undefined : next();
  };
}
