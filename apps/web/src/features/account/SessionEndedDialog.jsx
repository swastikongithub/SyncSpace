import { useState } from 'react';
import { useAuth } from '../../app/auth.jsx';
import { ApiError } from '../../lib/api.js';
import { Button } from '../../ui/Button.jsx';
import { Dialog } from '../../ui/Dialog.jsx';
import { TextField } from '../../ui/TextField.jsx';

function ReauthenticateForm({ email, onDismiss }) {
  const auth = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.signIn({ email, password });
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'SyncSpace could not be reached. Try again when you’re online.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <p className="text-sm">
        Signed in as <strong>{email}</strong>
      </p>
      <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      {error && (
        <p role="alert" className="text-sm font-semibold text-correction">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="quiet" onClick={onDismiss}>
          Keep working on this device
        </Button>
        <Button type="submit" variant="primary" disabled={busy || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </div>
    </form>
  );
}

function ExpiredSession({ email }) {
  const [dismissed, setDismissed] = useState(false);
  return (
    <>
      <Dialog
        open={!dismissed}
        onClose={() => setDismissed(true)}
        title="Your session ended"
        description="Sign in again to keep syncing. Anything you write meanwhile is saved on this device and sent once you’re back."
        size="sm"
      >
        <ReauthenticateForm email={email} onDismiss={() => setDismissed(true)} />
      </Dialog>
      {dismissed && (
        <div role="status" className="fixed inset-x-0 top-0 z-30 flex flex-wrap items-center justify-center gap-3 bg-ink px-4 py-2 text-sm text-sheet">
          <span>Signed out: edits are kept on this device until you sign in again.</span>
          <button type="button" onClick={() => setDismissed(false)} className="font-semibold underline underline-offset-2">
            Sign in
          </button>
        </div>
      )}
    </>
  );
}

/** Shown when the server rejects a session mid-use. Editing continues on this device meanwhile. */
export function SessionEndedDialog() {
  const auth = useAuth();
  if (auth.status !== 'expired' || !auth.user) return null;
  return <ExpiredSession email={auth.user.email} />;
}
