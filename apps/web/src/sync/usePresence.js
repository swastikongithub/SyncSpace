import { useCallback, useRef, useSyncExternalStore } from 'react';

const EMPTY = [];

/**
 * Other people with this document open, from the session's awareness states.
 * Identities are server-verified (the server overwrites the `user` field).
 */
export function usePresence(session) {
  const cache = useRef({ version: -1, value: EMPTY });
  const version = useRef(0);

  const subscribe = useCallback(
    (listener) => {
      if (!session) return () => {};
      const onChange = () => {
        version.current += 1;
        listener();
      };
      session.awareness.on('change', onChange);
      return () => session.awareness.off('change', onChange);
    },
    [session],
  );

  const read = () => {
    if (!session) return EMPTY;
    if (cache.current.version === version.current) return cache.current.value;
    const self = session.doc.clientID;
    const byUser = new Map();
    for (const [clientId, state] of session.awareness.getStates()) {
      if (clientId === self || !state?.user?.id) continue;
      const existing = byUser.get(state.user.id);
      byUser.set(state.user.id, {
        ...state.user,
        unsynced: Boolean(existing?.unsynced || state.unsynced),
        tabs: (existing?.tabs ?? 0) + 1,
      });
    }
    const value = [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
    cache.current = { version: version.current, value };
    return value;
  };

  return useSyncExternalStore(subscribe, read);
}
