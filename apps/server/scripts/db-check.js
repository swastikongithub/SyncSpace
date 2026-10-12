// Verifies the configured MongoDB is reachable through Mongoose and that a write/read/delete round trip works.
// Usage: npm run db:check
import mongoose from 'mongoose';
import { loadEnvFile, readConfig } from '../src/config.js';
import { connectDatabase, disconnectDatabase } from '../src/db.js';
import { createLogger, redactUri } from '../src/logger.js';

loadEnvFile();
const config = readConfig();
const logger = createLogger(config.logLevel === 'silent' ? 'info' : config.logLevel);

const ConnectionCheck = mongoose.model(
  'ConnectionCheck',
  new mongoose.Schema({ note: String, at: Date }, { collection: '_connection_checks' }),
);

try {
  await connectDatabase({ uri: config.mongoUri, logger, maxAttempts: config.db.maxAttempts, retryMs: config.db.retryMs });
  const { version } = await mongoose.connection.db.admin().command({ buildInfo: 1 });
  const created = await ConnectionCheck.create({ note: 'db-check', at: new Date() });
  const found = await ConnectionCheck.findById(created._id).lean();
  const { deletedCount } = await ConnectionCheck.deleteOne({ _id: created._id });
  if (!found || deletedCount !== 1) throw new Error('Round trip did not return the written document');
  console.log(
    JSON.stringify(
      {
        ok: true,
        target: redactUri(config.mongoUri),
        database: mongoose.connection.name,
        serverVersion: version,
        roundTrip: { inserted: String(created._id), readBack: true, deleted: deletedCount },
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`db-check failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
