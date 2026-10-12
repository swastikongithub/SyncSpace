import { useEffect, useRef, useState } from 'react';
import { browserNetwork, DocSyncSession } from '@syncspace/sync-client';
import { useAuth } from '../app/auth.jsx';
import { useLocalData } from '../app/local-data.jsx';
import { acquireDocLock } from '../lib/doc-lock.js';
import { useOnline } from '../lib/online.js';
import { isDocumentBusy, registerBackground } from './handoff.js';

const PER_DOCUMENT_TIMEOUT_MS = 30_000;
const RETRY_BUSY_MS = 3_000;

function socketUrl(docId) {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}/ws/documents/${docId}`;
}

/**
 * Connects a headless session and resolves once nothing is pending, it can't progress, or an
 * editor opens the document (which then takes over the local copy).
 */
async function syncOne({ docId, userId, store }) {
  const key = `syncspace:${userId}:${docId}`;
  if (isDocumentBusy(key)) return 'busy';
  const lock = await acquireDocLock(key, { exclusive: true });
  if (!lock) return 'busy';

  const session = new DocSyncSession({
    docId,
    url: socketUrl(docId),
    createSocket: (url) => new WebSocket(url),
    storage: store.forSession(),
    network: browserNetwork(window),
  });
  let finish;
  const outcome = new Promise((resolve) => {
    finish = resolve;
  });
  const unregister = registerBackground(key, async () => {
    finish('preempted');
    await work;
  });
  const work = (async () => {
    let timer;
    let unsubscribe = () => {};
    try {
      await session.start();
      timer = setTimeout(() => finish('timeout'), PER_DOCUMENT_TIMEOUT_MS);
      const check = (state) => {
        if (state.blocked) finish('blocked');
        else if (state.readOnlyRejected) finish('read-only');
        else if (state.serverSynced && state.localVersion <= state.durableVersion) finish('stored');
      };
      unsubscribe = session.on('change', check);
      check(session.state);
      await outcome;
    } finally {
      clearTimeout(timer);
      unsubscribe();
      await session.destroy();
      lock.release();
      unregister();
    }
  })();
  await work;
  return outcome;
}

/**
 * Sends edits saved on this device for documents that are not open, as soon as the user is
 * signed in and online, so unsent work does not wait for someone to reopen the document.
 * Documents that are busy (open in an editor, or just closing) are retried shortly after.
 */
export function BackgroundSync() {
  const { user, status } = useAuth();
  const { store, pendingDocs, refresh } = useLocalData();
  const online = useOnline();
  const running = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const pendingKey = pendingDocs.map((meta) => `${meta.docId}:${meta.pending}`).join(',');

  useEffect(() => {
    if (status !== 'signed-in' || !online || !store || !user || running.current || pendingDocs.length === 0) return undefined;
    running.current = true;
    let retry;
    void (async () => {
      let busy = false;
      try {
        for (const meta of pendingDocs) {
          if (!navigator.onLine) break;
          const result = await syncOne({ docId: meta.docId, userId: user.id, store }).catch(() => 'failed');
          if (result === 'busy') busy = true;
        }
      } finally {
        running.current = false;
        void refresh();
        if (busy) retry = setTimeout(() => setAttempt((n) => n + 1), RETRY_BUSY_MS);
      }
    })();
    return () => clearTimeout(retry);
    // pendingKey captures the pending set; re-run when it, the connection, the session or a retry changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, online, store, user?.id, pendingKey, attempt]);

  return null;
}
