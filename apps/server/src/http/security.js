import helmet from 'helmet';
import { forbidden } from './errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const REQUEST_HEADER = 'x-syncspace-request';

/**
 * CSRF defence for cookie-authenticated requests (OWASP "verify origin" + "custom request header"):
 *  - a browser Origin header, when present, must be an allowed origin;
 *  - Sec-Fetch-Site must not say the request is cross-site;
 *  - state-changing requests must carry X-SyncSpace-Request, which a cross-site form cannot set,
 *    and which a cross-site fetch cannot set without a CORS preflight we never approve.
 * SameSite=Lax session cookies are the third, independent layer.
 */
export function requestGuard({ allowedOrigins }) {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    if (origin && !allowed.has(origin)) {
      return next(forbidden('origin_not_allowed', 'Requests from this origin are not allowed.'));
    }
    if (req.get('sec-fetch-site') === 'cross-site') {
      return next(forbidden('cross_site_request', 'Cross-site requests are not allowed.'));
    }
    if (req.get(REQUEST_HEADER) !== '1') {
      return next(forbidden('missing_request_header', 'Missing X-SyncSpace-Request header.'));
    }
    return next();
  };
}

export function isAllowedOrigin(origin, allowedOrigins) {
  return typeof origin === 'string' && allowedOrigins.includes(origin);
}

export function securityHeaders({ allowedOrigins, isProduction }) {
  const socketOrigins = allowedOrigins.map((origin) => origin.replace(/^http/, 'ws'));
  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        // ProseMirror and React write inline style attributes; no inline scripts are permitted.
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'font-src': ["'self'"],
        'connect-src': ["'self'", ...socketOrigins],
        'worker-src': ["'self'"],
        'manifest-src': ["'self'"],
        'frame-ancestors': ["'none'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'upgrade-insecure-requests': isProduction ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: isProduction ? undefined : false,
  });
}
