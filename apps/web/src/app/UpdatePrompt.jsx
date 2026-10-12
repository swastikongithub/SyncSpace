import { useEffect, useState } from 'react';
import { Button } from '../ui/Button.jsx';

/**
 * Registers the service worker (production builds only) and offers — never forces — a reload
 * when a new version is ready, so nobody loses their place mid-sentence.
 */
export function UpdatePrompt() {
  const [update, setUpdate] = useState(null);

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let cancelled = false;
    import('virtual:pwa-register').then(({ registerSW }) => {
      if (cancelled) return;
      const updateSW = registerSW({
        onNeedRefresh: () => setUpdate(() => updateSW),
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update) return null;
  return (
    <div role="status" className="fixed bottom-4 right-4 z-40 flex max-w-sm items-center gap-3 rounded-lg border border-rule bg-sheet p-3 pl-4 shadow-sheet">
      <p className="text-sm">A new version of SyncSpace is ready.</p>
      <Button size="sm" variant="primary" onClick={() => update(true)}>
        Reload
      </Button>
      <Button size="sm" variant="quiet" onClick={() => setUpdate(null)}>
        Later
      </Button>
    </div>
  );
}
