import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const AnnouncerContext = createContext(() => {});

/**
 * Screen-reader announcements for state changes that happen without the user acting
 * (going offline, syncing finished, a collaborator restored a version).
 * Also shows a brief visible toast for the same message.
 */
export function AnnouncerProvider({ children }) {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const announce = useCallback((message, { urgent = false, visible = true } = {}) => {
    // Clearing first makes repeated identical messages announce again.
    const set = urgent ? setAssertive : setPolite;
    set('');
    requestAnimationFrame(() => set(message));
    if (visible) {
      clearTimeout(timer.current);
      setToast({ message, urgent, id: Date.now() });
      timer.current = setTimeout(() => setToast(null), 5000);
    }
  }, []);

  const value = useMemo(() => announce, [announce]);

  return (
    <AnnouncerContext.Provider value={value}>
      {children}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
      {toast && (
        <div
          key={toast.id}
          aria-hidden="true"
          className={`pointer-events-none fixed bottom-4 left-1/2 z-50 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-md px-4 py-2.5 text-sm font-semibold shadow-sheet ${
            toast.urgent ? 'bg-correction text-sheet' : 'bg-ink text-sheet'
          }`}
        >
          {toast.message}
        </div>
      )}
    </AnnouncerContext.Provider>
  );
}

export function useAnnounce() {
  return useContext(AnnouncerContext);
}
