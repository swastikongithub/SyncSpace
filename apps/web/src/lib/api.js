export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** The request never reached a working server (offline, DNS, server down). */
export class NetworkError extends Error {
  constructor(message = 'SyncSpace could not be reached. Check your connection.') {
    super(message);
  }
}

let unauthorizedHandler = null;

/** Called when any request returns 401, so the app can show the "session ended" state. */
export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

async function request(method, path, { body, raw, headers = {}, signal, responseType = 'json' } = {}) {
  const init = {
    method,
    credentials: 'same-origin',
    signal,
    headers: { Accept: 'application/json', ...headers },
  };
  if (method !== 'GET' && method !== 'HEAD') init.headers['X-SyncSpace-Request'] = '1';
  if (raw !== undefined) {
    init.body = raw;
    init.headers['Content-Type'] = 'application/octet-stream';
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers['Content-Type'] = 'application/json';
  }

  let response;
  try {
    response = await fetch(`/api${path}`, init);
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new NetworkError();
  }
  // A proxy or load balancer answering for a server that is down.
  if ([502, 503, 504].includes(response.status) && !response.headers.get('content-type')?.includes('json')) {
    throw new NetworkError('The SyncSpace server is not responding right now.');
  }
  if (response.status === 204) return null;
  if (response.ok && responseType === 'bytes') return new Uint8Array(await response.arrayBuffer());

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = data?.error ?? {};
    const apiError = new ApiError(
      response.status,
      error.code ?? `http_${response.status}`,
      error.message ?? 'The request failed.',
      error.details,
    );
    if (response.status === 401 && !path.startsWith('/auth/')) unauthorizedHandler?.(apiError);
    throw apiError;
  }
  return data;
}

export const api = {
  get: (path, options) => request('GET', path, options),
  getBytes: (path, options) => request('GET', path, { ...options, responseType: 'bytes' }),
  post: (path, body, options) => request('POST', path, { ...options, body }),
  postBytes: (path, raw, options) => request('POST', path, { ...options, raw }),
  patch: (path, body, options) => request('PATCH', path, { ...options, body }),
  delete: (path, body, options) => request('DELETE', path, { ...options, body }),
};

/** First field error for a form field, from a validation_failed response. */
export function fieldError(error, field) {
  return error instanceof ApiError ? error.details?.fieldErrors?.[field]?.[0] : undefined;
}
