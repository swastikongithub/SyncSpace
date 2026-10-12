import { createServer } from 'node:http';
import { createActivityRecorder } from './activity/service.js';
import { createApp } from './app.js';
import { createAuthenticator, sessionCookieName } from './auth/middleware.js';
import { createSessionStore } from './auth/sessions.js';
import { createCollabService } from './collab/service.js';
import { createDocStore } from './collab/store.js';
import { createMetrics } from './diagnostics/metrics.js';
import { createDocumentsService } from './documents/service.js';
import { createHistoryService } from './history/service.js';

/**
 * Composition root: wires services together and starts HTTP + WebSocket on one port.
 * Expects the database connection to be open already (see index.js).
 */
export async function startServer({ config, logger, collabSettings, port = config.port, host }) {
  const metrics = createMetrics();
  const sessions = createSessionStore({ ttlMs: config.session.ttlMs, idleMs: config.session.idleMs });
  const cookie = { name: sessionCookieName(config.session.cookieSecure), secure: config.session.cookieSecure, maxAgeMs: config.session.ttlMs };
  const authenticate = createAuthenticator({ sessions, cookieName: cookie.name });
  const store = createDocStore();
  const activity = createActivityRecorder(logger);
  const history = createHistoryService();

  const ctx = { config, logger, metrics, sessions, cookie, authenticate, store, activity, history, rateLimits: config.rateLimits };
  ctx.documentsService = createDocumentsService({ store, activity, getCollab: () => ctx.collab });
  ctx.collab = createCollabService({
    config,
    logger,
    authenticate,
    sessions,
    metrics,
    store,
    settings: collabSettings,
    hooks: {
      onContentChanged: ctx.documentsService.onContentChanged,
      createVersion: history.createVersionForRoom,
    },
  });

  const app = createApp(ctx);
  const httpServer = createServer(app);
  httpServer.on('upgrade', ctx.collab.handleUpgrade);
  httpServer.headersTimeout = 20_000;
  httpServer.requestTimeout = 30_000;

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
  const address = httpServer.address();
  const url = `http://${host && host !== '0.0.0.0' ? host : 'localhost'}:${address.port}`;

  async function close({ graceful = true } = {}) {
    await ctx.collab.shutdown({ graceful });
    await new Promise((resolve) => {
      httpServer.close(() => resolve());
      httpServer.closeAllConnections?.();
    });
  }

  return { app, httpServer, ctx, url, port: address.port, close };
}
