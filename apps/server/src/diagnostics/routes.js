import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { databaseState, isDatabaseReady } from '../db.js';

export function healthRoute() {
  const router = Router();
  // Public liveness/readiness probe: no user data, just whether the database is reachable.
  router.get('/', (req, res) => {
    const ready = isDatabaseReady();
    res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'degraded', database: databaseState() });
  });
  return router;
}

export function diagnosticsRoutes(ctx) {
  const router = Router();
  router.use(requireAuth);
  // Aggregate server health for signed-in users. Contains counts and latencies only.
  router.get('/', (req, res) => {
    res.json({
      database: databaseState(),
      collaboration: ctx.collab.stats(),
      memory: { rssMb: Math.round(process.memoryUsage().rss / 1_048_576) },
      ...ctx.metrics.snapshot(),
    });
  });
  return router;
}
