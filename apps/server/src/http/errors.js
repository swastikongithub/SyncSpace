export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) => new HttpError(400, code, message, details);
export const unauthorized = (code = 'unauthenticated', message = 'Sign in to continue.') => new HttpError(401, code, message);
export const forbidden = (code, message) => new HttpError(403, code, message);
export const notFound = (code, message) => new HttpError(404, code, message);
export const conflict = (code, message, details) => new HttpError(409, code, message, details);

const DATABASE_UNAVAILABLE = new Set([
  'MongoNotConnectedError',
  'MongoServerSelectionError',
  'MongooseServerSelectionError',
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
]);

function isDatabaseUnavailable(error) {
  return (
    DATABASE_UNAVAILABLE.has(error?.name) ||
    // Mongoose raises this when bufferCommands is off and the connection is down.
    /before initial connection is complete|Client must be connected/i.test(error?.message ?? '')
  );
}

export function notFoundHandler(req, res, next) {
  next(notFound('route_not_found', `No API route for ${req.method} ${req.path}`));
}

export function errorHandler(logger) {
  // Express identifies error middleware by arity, so all four parameters are required.
  // eslint-disable-next-line no-unused-vars
  return (error, req, res, next) => {
    let status = 500;
    let body = { code: 'internal_error', message: 'Something went wrong on the server.' };

    if (error instanceof HttpError) {
      status = error.status;
      body = { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) };
    } else if (error?.type === 'entity.too.large') {
      status = 413;
      body = { code: 'payload_too_large', message: 'The request body is too large.' };
    } else if (error?.type === 'entity.parse.failed') {
      status = 400;
      body = { code: 'invalid_json', message: 'The request body is not valid JSON.' };
    } else if (isDatabaseUnavailable(error)) {
      status = 503;
      body = { code: 'database_unavailable', message: 'The database is temporarily unavailable. Try again shortly.' };
      logger.warn({ err: { name: error.name, message: error.message } }, 'Request failed: database unavailable');
    } else {
      logger.error({ err: error, path: req.path }, 'Unhandled request error');
    }

    if (res.headersSent) return;
    res.status(status).json({ error: body });
  };
}
