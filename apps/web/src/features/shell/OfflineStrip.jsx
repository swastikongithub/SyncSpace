import { WifiOff } from 'lucide-react';
import { useAuth } from '../../app/auth.jsx';
import { useLocalData } from '../../app/local-data.jsx';
import { useOnline } from '../../lib/online.js';

/** A calm, persistent note while offline. Offline is a mode, not an error. */
export function OfflineStrip() {
  const online = useOnline();
  const auth = useAuth();
  const { pendingTotal } = useLocalData();
  const serverUnreachable = auth.status === 'offline';
  if (online && !serverUnreachable) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 border-b border-caution/30 bg-caution-wash px-4 py-2 text-center text-sm text-ink">
      <WifiOff aria-hidden="true" size={16} className="flex-none text-caution" />
      <span>
        {online ? 'The SyncSpace server can’t be reached.' : 'You’re offline.'} Documents saved on this device stay editable
        {pendingTotal > 0 ? `; ${pendingTotal} ${pendingTotal === 1 ? 'edit is' : 'edits are'} waiting to sync.` : ', and edits sync when you reconnect.'}
      </span>
    </div>
  );
}
