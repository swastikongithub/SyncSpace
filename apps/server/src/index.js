import { ConfigError, loadEnvFile, readConfig } from './config.js';
import { connectDatabase, disconnectDatabase, ensureIndexes } from './db.js';
import { createLogger } from './logger.js';
import { startServer } from './server.js';

loadEnvFile();

let config;
try {
  config = readConfig();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const logger = createLogger(config.logLevel);

try {
  await connectDatabase({ uri: config.mongoUri, logger, maxAttempts: config.db.maxAttempts, retryMs: config.db.retryMs });
  await ensureIndexes();
} catch (error) {
  logger.fatal({ err: { message: error.message } }, 'Startup aborted: database unavailable');
  process.exit(1);
}

const server = await startServer({ config, logger });
logger.info({ url: server.url, env: config.env }, 'SyncSpace server listening');

let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'Shutting down: flushing open documents');
  const forceExit = setTimeout(() => {
    logger.error('Shutdown timed out; exiting');
    process.exit(1);
  }, 15_000);
  forceExit.unref();
  try {
    await server.close({ graceful: true });
    await disconnectDatabase();
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
