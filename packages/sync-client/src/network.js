/** Network signal backed by the browser's online/offline events. */
export function browserNetwork(target = globalThis) {
  return {
    isOnline: () => target.navigator?.onLine !== false,
    subscribe(listener) {
      const online = () => listener(true);
      const offline = () => listener(false);
      target.addEventListener('online', online);
      target.addEventListener('offline', offline);
      return () => {
        target.removeEventListener('online', online);
        target.removeEventListener('offline', offline);
      };
    },
  };
}

/** A network signal tests (and simulations) can switch by hand. */
export function manualNetwork(initiallyOnline = true) {
  let online = initiallyOnline;
  const listeners = new Set();
  return {
    isOnline: () => online,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(value) {
      if (online === value) return;
      online = value;
      for (const listener of listeners) listener(value);
    },
  };
}
