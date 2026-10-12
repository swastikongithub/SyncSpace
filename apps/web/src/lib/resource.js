// A small keyed cache for server data with an offline fallback.
//
// When a request fails because the network is unavailable, `fallback()` (usually a read from the
// IndexedDB catalog) supplies the last copy saved on this device, marked `source: 'device'` so the
// UI can say so. Server errors (403, 404, …) are never masked by stale data.
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { NetworkError } from './api.js';

const STALE_AFTER_MS = 20_000;
const entries = new Map();
const listeners = new Map();
const loaders = new Map();

const EMPTY = Object.freeze({ status: 'idle', data: undefined, error: null, source: null, updatedAt: 0 });

function notify(key) {
  for (const listener of listeners.get(key) ?? []) listener();
}

function setEntry(key, patch) {
  entries.set(key, { ...(entries.get(key) ?? EMPTY), ...patch });
  notify(key);
}

export function getEntry(key) {
  return entries.get(key) ?? EMPTY;
}

export async function load(key, { force = false } = {}) {
  const loader = loaders.get(key);
  if (!loader) return;
  const current = getEntry(key);
  if (current.pending && !force) return current.pending;
  const pending = (async () => {
    try {
      const data = await loader.fetcher();
      setEntry(key, { status: 'success', data, error: null, source: 'network', updatedAt: Date.now(), pending: null });
      loader.onData?.(data);
    } catch (error) {
      if (error instanceof NetworkError && loader.fallback) {
        const cached = await loader.fallback().catch(() => null);
        if (cached) {
          setEntry(key, { status: 'success', data: cached.data, savedAt: cached.savedAt, error, source: 'device', pending: null });
          return;
        }
      }
      setEntry(key, { status: 'error', error, pending: null });
    }
  })();
  setEntry(key, { status: current.data === undefined ? 'loading' : current.status, pending });
  return pending;
}

/** Re-fetch every loaded key starting with `prefix`. */
export function invalidate(prefix) {
  for (const key of entries.keys()) if (key.startsWith(prefix)) void load(key, { force: true });
}

/** Optimistically replace cached data (e.g. after a successful mutation). */
export function setData(key, updater) {
  const current = getEntry(key);
  const data = typeof updater === 'function' ? updater(current.data) : updater;
  setEntry(key, { status: 'success', data, error: null, source: 'network', updatedAt: Date.now() });
}

export function clearAll() {
  entries.clear();
  for (const key of listeners.keys()) notify(key);
}

/**
 * Subscribes to a cached resource and loads it when missing or stale.
 * `key` may be null to skip loading (e.g. while a dependency is unknown).
 */
export function useResource(key, fetcher, { fallback, onData } = {}) {
  if (key) loaders.set(key, { fetcher, fallback, onData });
  const subscribe = useCallback(
    (listener) => {
      if (!key) return () => {};
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(listener);
      return () => listeners.get(key)?.delete(listener);
    },
    [key],
  );
  const entry = useSyncExternalStore(subscribe, () => (key ? getEntry(key) : EMPTY));
  useEffect(() => {
    if (!key) return;
    const current = getEntry(key);
    if (current.status === 'idle' || current.status === 'error' || Date.now() - current.updatedAt > STALE_AFTER_MS) void load(key);
  }, [key]);
  const reload = useCallback(() => (key ? load(key, { force: true }) : undefined), [key]);
  return { ...entry, reload };
}
