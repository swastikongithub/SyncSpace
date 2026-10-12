import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../app/auth.jsx';
import { useLocalData } from '../../app/local-data.jsx';
import { Button } from '../../ui/Button.jsx';
import { Dialog } from '../../ui/Dialog.jsx';

/**
 * Sign-out on a device that may hold unsent work. The choices are explicit:
 * keep this device's copies (they sync on the next sign-in here), or erase them.
 * Mounted only while open, so every opening starts from the safe default.
 */
function SignOutFlow({ onClose }) {
  const auth = useAuth();
  const { pendingDocs, refresh } = useLocalData();
  const navigate = useNavigate();
  const [erase, setErase] = useState(false);
  const [confirmLoss, setConfirmLoss] = useState(false);
  const [busy, setBusy] = useState(false);
  const [offlineResult, setOfflineResult] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hasPending = pendingDocs.length > 0;
  const blocked = erase && hasPending && !confirmLoss;

  async function signOut() {
    setBusy(true);
    try {
      const outcome = await auth.signOut({ eraseDevice: erase });
      if (!outcome.serverConfirmed) {
        setOfflineResult(true);
        setBusy(false);
        return;
      }
      navigate('/signin', { replace: true });
    } catch {
      setBusy(false);
    }
  }

  if (offlineResult) {
    return (
      <Dialog open onClose={() => navigate('/signin', { replace: true })} title="Signed out on this device" size="sm">
        <p className="text-sm">
          You’re offline, so the server hasn’t ended your session yet. SyncSpace will end it automatically the next time this
          browser is online.
        </p>
        <div className="flex justify-end">
          <Button variant="primary" onClick={() => navigate('/signin', { replace: true })}>
            Done
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} title="Sign out" size="md">
      {hasPending ? (
        <div className="flex flex-col gap-2 rounded-md border border-carbon/40 bg-carbon-wash p-4">
          <p className="font-bold">Some changes haven’t reached the server</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {pendingDocs.map((meta) => (
              <li key={meta.docId}>
                {meta.title || 'Untitled'}: {meta.pending} {meta.pending === 1 ? 'edit' : 'edits'}
              </li>
            ))}
          </ul>
          <p className="text-sm">If you keep them on this device, they’ll be sent the next time you sign in here.</p>
        </div>
      ) : (
        <p className="text-sm">Everything you wrote on this device is stored on the server.</p>
      )}

      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Offline copies on this device</legend>
        <label className="flex items-start gap-3 rounded-md border border-rule p-3">
          <input type="radio" name="device-copies" className="mt-1 accent-[var(--carbon)]" checked={!erase} onChange={() => setErase(false)} />
          <span>
            <span className="block font-semibold">Keep my offline copies on this device</span>
            <span className="block text-sm text-graphite">Fine on your own computer. Nobody else who signs in here can open them.</span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-md border border-rule p-3">
          <input type="radio" name="device-copies" className="mt-1 accent-[var(--carbon)]" checked={erase} onChange={() => setErase(true)} />
          <span>
            <span className="block font-semibold">Erase my offline copies from this device</span>
            <span className="block text-sm text-graphite">Recommended on shared or public computers.</span>
          </span>
        </label>
        {erase && hasPending && (
          <label className="flex items-start gap-3 text-sm font-semibold text-correction">
            <input type="checkbox" className="mt-0.5 accent-[var(--correction)]" checked={confirmLoss} onChange={(e) => setConfirmLoss(e.target.checked)} />
            I understand the unsent changes listed above will be lost.
          </label>
        )}
      </fieldset>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="quiet" onClick={onClose}>
          Stay signed in
        </Button>
        <Button variant={erase ? 'danger' : 'primary'} onClick={signOut} disabled={busy || blocked}>
          {busy ? 'Signing out…' : erase ? 'Erase and sign out' : 'Sign out'}
        </Button>
      </div>
    </Dialog>
  );
}

export function SignOutDialog({ open, onClose }) {
  return open ? <SignOutFlow onClose={onClose} /> : null;
}
