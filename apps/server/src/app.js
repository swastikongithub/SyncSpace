import { existsSync } from 'node:fs';
import { join } from 'node:path';
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
    app.use(
      express.static(config.webDistDir, {
        index: false,
        setHeaders(res, path) {
          if (path.includes(`${join('assets', '')}`)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
          else res.set('Cache-Control', 'no-cache');
        },
      }),
    );
    app.get(/^(?!\/api\/|\/ws\/).*/, (req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  }

  app.use(errorHandler(logger));
  return app;
}
