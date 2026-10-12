import { setTimeout as delay } from 'node:timers/promises';
import mongoose from 'mongoose';
import { redactUri } from './logger.js';

mongoose.set('strictQuery', true);

const READY_STATES = ['disconnected', 'connected', 'connecting', 'disconnecting'];

export function databaseState() {
  return READY_STATES[mongoose.connection.readyState] ?? 'unknown';
}

export function isDatabaseReady() {
  return mongoose.connection.readyState === 1;
}

let listenersAttached = false;
let closingIntentionally = false;

function attachConnectionListeners(logger) {
  if (listenersAttached) return;
  listenersAttached = true;
  const { connection } = mongoose;
  connection.on('disconnected', () => {
    if (!closingIntentionally) logger.warn('MongoDB disconnected; the driver will keep retrying');
  });
  connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  connection.on('error', (error) => logger.error({ err: { name: error.name, message: error.message } }, 'MongoDB error'));
}

/**
 * Connects with exponential backoff so the backend tolerates a database that is still starting
 * (e.g. a container that is not healthy yet). Throws after `maxAttempts` failures.
 */
export async function connectDatabase({ uri, logger, maxAttempts = 10, retryMs = 500, serverSelectionTimeoutMS = 5000 }) {
  const target = redactUri(uri);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS,
        // Fail fast instead of queueing operations while disconnected; callers surface 503s.
        bufferCommands: false,
        autoIndex: false,
      });
      await mongoose.connection.db.admin().command({ ping: 1 });
      // Runtime listeners are attached only once connected; startup failures are reported by the retry loop.
      attachConnectionListeners(logger);
      logger.info({ target, attempt }, 'Connected to MongoDB');
      return mongoose.connection;
    } catch (error) {
      await disconnectDatabase().catch(() => {});
      const lastAttempt = attempt === maxAttempts;
      logger[lastAttempt ? 'error' : 'warn'](
        { target, attempt, maxAttempts, err: { name: error.name, message: error.message } },
        lastAttempt ? 'Giving up connecting to MongoDB' : 'MongoDB not reachable yet; retrying',
      );
      if (lastAttempt) {
        throw new Error(`Could not connect to MongoDB at ${target} after ${maxAttempts} attempts: ${error.message}`, {
          cause: error,
        });
      }
      await delay(Math.min(retryMs * 2 ** (attempt - 1), 10_000));
    }
  }
  throw new Error('unreachable');
}

/** Builds indexes explicitly (autoIndex is off) so startup fails loudly on index problems. */
export async function ensureIndexes() {
  const models = Object.values(mongoose.models);
  await Promise.all(models.map((model) => model.createIndexes()));
}

export async function disconnectDatabase() {
  closingIntentionally = true;
  try {
    await mongoose.disconnect();
  } finally {
    closingIntentionally = false;
  }
}
