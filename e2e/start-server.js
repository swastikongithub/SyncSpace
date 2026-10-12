// Starts an isolated SyncSpace for end-to-end tests: an ephemeral MongoDB (or E2E_MONGODB_URI)
// and the API serving the production web build on one origin, as in deployment.
import { MongoMemoryServer } from 'mongodb-memory-server';

const port = process.env.E2E_PORT ?? '4300';
let mongod;
if (!process.env.E2E_MONGODB_URI) {
  mongod = await MongoMemoryServer.create();
}
const base = process.env.E2E_MONGODB_URI ?? mongod.getUri();
const uri = new URL(base);
uri.pathname = '/syncspace_e2e';

Object.assign(process.env, {
  NODE_ENV: 'development',
  PORT: port,
  MONGODB_URI: uri.toString(),
  APP_ORIGINS: `http://localhost:${port}`,
  SERVE_WEB: 'true',
  LOG_LEVEL: 'warn',
  // Every test registers fresh accounts from the same address.
  RATE_LIMIT_REGISTER: '1000',
  RATE_LIMIT_LOGIN: '1000',
});

const stop = async () => {
  await mongod?.stop();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

await import('../apps/server/src/index.js');
