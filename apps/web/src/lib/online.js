import { useSyncExternalStore } from 'react';

function subscribe(listener) {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

/** The browser's view of connectivity. Real reachability is judged per request and per socket. */
export function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine !== false);
}
