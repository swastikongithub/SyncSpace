import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { openUserStore } from '@syncspace/sync-client';
import { useAuth } from './auth.jsx';

const LocalDataContext = createContext(null);

/**
 * Opens the signed-in user's own IndexedDB database and tracks which documents have a copy on
 * this device and how many changes each holds that the server has not confirmed.
 * Keyed by user, so switching accounts starts from a clean slate.
 */
export function LocalDataProvider({ children }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  return (
    <UserLocalData key={userId ?? 'signed-out'} userId={userId}>
      {children}
    </UserLocalData>
  );
}

function UserLocalData({ userId, children }) {
  const [store, setStore] = useState(null);
  const [error, setError] = useState(null);
  const [docs, setDocs] = useState(() => new Map());

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    let opened = null;
    openUserStore(userId)
      .then(async (result) => {
        opened = result;
        if (cancelled) {
          result.close();
          return;
        }
        const list = await result.listDocs().catch(() => []);
        if (cancelled) return;
        setDocs(new Map(list.map((meta) => [meta.docId, meta])));
        setStore(result);
      })
      .catch((failure) => {
        if (!cancelled) setError(failure);
      });
    return () => {
      cancelled = true;
      opened?.close();
    };
  }, [userId]);

  const refresh = useCallback(async () => {
    if (!store) return;
    const list = await store.listDocs().catch(() => []);
    setDocs(new Map(list.map((meta) => [meta.docId, meta])));
  }, [store]);

  const value = useMemo(() => {
    const pending = [...docs.values()].filter((meta) => meta.pending > 0);
    return {
      store,
      error,
      ready: Boolean(store) || Boolean(error) || !userId,
      docs,
      pendingDocs: pending,
      pendingTotal: pending.reduce((sum, meta) => sum + meta.pending, 0),
      refresh,
    };
  }, [store, error, docs, refresh, userId]);

  return <LocalDataContext.Provider value={value}>{children}</LocalDataContext.Provider>;
}

export function useLocalData() {
  const value = useContext(LocalDataContext);
  if (!value) throw new Error('useLocalData must be used inside LocalDataProvider');
  return value;
}
