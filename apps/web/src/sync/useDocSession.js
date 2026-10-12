import { useCallback, useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react';
import { browserNetwork, DocSyncSession } from '@syncspace/sync-client';
import { useAuth } from '../app/auth.jsx';
import { useLocalData } from '../app/local-data.jsx';
import { api } from '../lib/api.js';
import { acquireDocLock } from '../lib/doc-lock.js';

const network = typeof window !== 'undefined' ? browserNetwork(window) : null;

function socketUrl(docId) {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}/ws/documents/${docId}`;
}

const NO_STATE = Object.freeze({});
const noopSubscribe = () => () => {};

/**
 * Runs the sync engine for one document while the page is open.
 *
 * phase: 'starting' | 'locked' (open in another tab) | 'moved' (another tab took over) | 'ready'
 *
 * `onRecovery` receives { stored, uploaded } when a merge removed unsent offline text; the
 * pre-merge copy is first kept on this device, then uploaded as a "recovered" version.
 */
export function useDocSession(docId, { workspaceId, title, onRecovery, onRestored } = {}) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const local = useLocalData();
  const [handle, setHandle] = useState({ phase: 'starting', session: null });
  const [takeover, setTakeover] = useState(0);
  const emitRecovery = useEffectEvent((outcome) => onRecovery?.(outcome));
  const emitRestored = useEffectEvent((notice) => onRestored?.(notice));
  const { store, ready: storeReady, refresh } = local;

  useEffect(() => {
    if (!docId || !userId || !storeReady) return undefined;
    let cancelled = false;
    let session = null;
    let lock = null;

    (async () => {
      lock = await acquireDocLock(`syncspace:${userId}:${docId}`, { steal: takeover > 0 });
      if (cancelled) {
        lock?.release();
        return;
      }
      if (!lock) {
        setHandle({ phase: 'locked', session: null });
        return;
      }
      lock.stolen.then(() => {
        if (cancelled) return;
        cancelled = true;
        void session?.destroy();
        setHandle({ phase: 'moved', session: null });
      });

      session = new DocSyncSession({
        docId,
        url: socketUrl(docId),
        createSocket: (url) => new WebSocket(url),
        storage: store ? store.forSession() : null,
        network,
      });
      session.on('recovery', async ({ state }) => {
        let key = null;
        try {
          key = store ? await store.addRecovery(docId, state) : null;
          await api.postBytes(`/documents/${docId}/versions/recovered`, state, {
            headers: { 'X-SyncSpace-Label': 'Offline copy before merge' },
          });
          if (key !== null) await store.markRecoveryUploaded(key);
          emitRecovery({ stored: true, uploaded: true });
        } catch {
          emitRecovery({ stored: key !== null, uploaded: false });
        }
      });
      session.on('restored', (notice) => emitRestored(notice));
      await session.start();
      if (cancelled) {
        await session.destroy();
        lock.release();
        return;
      }
      setHandle({ phase: 'ready', session });
    })();

    return () => {
      cancelled = true;
      const closing = session;
      const held = lock;
      setHandle({ phase: 'starting', session: null });
      void (async () => {
        await closing?.destroy();
        held?.release();
        void refresh();
      })();
    };
  }, [docId, userId, store, storeReady, takeover, refresh]);

  // Remember what this copy is, so the offline document list can show it.
  useEffect(() => {
    if (store && workspaceId) void store.setDocInfo(docId, { workspaceId, title }).catch(() => {});
  }, [store, docId, workspaceId, title]);

  const session = handle.session;
  const subscribe = useCallback((listener) => (session ? session.on('change', listener) : () => {}), [session]);
  const state = useSyncExternalStore(session ? subscribe : noopSubscribe, () => (session ? session.state : NO_STATE));

  // Keep the per-document pending counts in the document list current.
  const pending = session ? Math.max(0, (state.localVersion ?? 0) - (state.durableVersion ?? 0)) : 0;
  const hadPending = useRef(false);
  useEffect(() => {
    const has = pending > 0;
    if (has !== hadPending.current) {
      hadPending.current = has;
      void refresh();
    }
  }, [pending, refresh]);

  const takeOver = useCallback(() => setTakeover((value) => value + 1), []);

  return { phase: handle.phase, session, state, hasStorage: Boolean(store), takeOver };
}
