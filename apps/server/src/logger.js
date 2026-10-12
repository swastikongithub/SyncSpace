import pino from 'pino';

export function createLogger(level = 'info') {
  return pino({
    level,
    redact: {
      paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]', '*.password', '*.token'],
      censor: '[redacted]',
    },
  });
}

/** Hides credentials in a connection string so it can be logged. */
export function redactUri(uri) {
  return uri.replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:***@');
}
