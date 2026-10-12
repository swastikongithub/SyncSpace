import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Loads `.env` from the repository root. Real environment variables always win. */
export function loadEnvFile() {
  const path = resolve(repoRoot, '.env');
  if (existsSync(path)) dotenv.config({ path, quiet: true });
}

const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  MONGODB_URI: z
    .string({ error: 'MONGODB_URI is required (see .env.example)' })
    .regex(/^mongodb(\+srv)?:\/\//, 'MONGODB_URI must start with mongodb:// or mongodb+srv://'),
  APP_ORIGINS: z.string().default('http://localhost:5173'),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(168),
  SESSION_IDLE_HOURS: z.coerce.number().positive().default(72),
  COOKIE_SECURE: booleanish.optional(),
  TRUST_PROXY: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DB_CONNECT_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(10),
  DB_CONNECT_RETRY_MS: z.coerce.number().int().min(10).default(500),
  WEB_DIST_DIR: z.string().optional(),
});

export class ConfigError extends Error {}

/** Parses and validates configuration. Never includes secret values in error messages. */
export function readConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
    throw new ConfigError(`Invalid configuration:\n${problems.join('\n')}`);
  }
  const values = parsed.data;
  const isProduction = values.NODE_ENV === 'production';
  return {
    env: values.NODE_ENV,
    isProduction,
    port: values.PORT,
    mongoUri: values.MONGODB_URI,
    allowedOrigins: values.APP_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
    session: {
      ttlMs: values.SESSION_TTL_HOURS * 3_600_000,
      idleMs: values.SESSION_IDLE_HOURS * 3_600_000,
      cookieSecure: values.COOKIE_SECURE ?? isProduction,
    },
    trustProxy: parseTrustProxy(values.TRUST_PROXY),
    logLevel: values.NODE_ENV === 'test' ? 'silent' : values.LOG_LEVEL,
    db: {
      maxAttempts: values.DB_CONNECT_MAX_ATTEMPTS,
      retryMs: values.DB_CONNECT_RETRY_MS,
    },
    webDistDir: values.WEB_DIST_DIR ? resolve(values.WEB_DIST_DIR) : resolve(repoRoot, 'apps/web/dist'),
  };
}

function parseTrustProxy(value) {
  if (value === undefined || value === '') return false;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}
