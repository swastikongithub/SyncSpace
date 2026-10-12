import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '../../app/auth.jsx';
import { DeskMessage } from '../../app/RootLayout.jsx';
import { api, ApiError } from '../../lib/api.js';
import { invalidate, useResource } from '../../lib/resource.js';
import { shortDateTime } from '../../lib/time.js';
import { Button, ButtonLink } from '../../ui/Button.jsx';

const ROLE_WORDS = { owner: 'an owner', editor: 'an editor', viewer: 'a viewer' };

export function InvitePage() {
  const { token } = useParams();
  const auth = useAuth();
  const navigate = useNavigate();
  const preview = useResource(`invite:${token}`, () => api.get(`/invitations/${token}`).then((body) => body.invitation));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const here = `/invite/${token}`;

  if (preview.status === 'loading' || preview.status === 'idle') return <DeskMessage title="Opening invitation…" />;
  if (preview.status === 'error') {
    return (
      <DeskMessage title="This invitation link doesn’t work" action={<ButtonLink to="/">Go to SyncSpace</ButtonLink>}>
        {preview.error instanceof ApiError ? preview.error.message : 'Check your connection and try again.'}
      </DeskMessage>
    );
  }

  const invitation = preview.data;
  if (invitation.status !== 'pending') {
    const reason = { accepted: 'has already been used', revoked: 'was withdrawn', expired: 'has expired' }[invitation.status];
    return (
      <DeskMessage title={`This invitation ${reason}`} action={<ButtonLink to="/">Go to SyncSpace</ButtonLink>}>
        Ask {invitation.invitedBy ?? 'the person who invited you'} for a new link to {invitation.workspaceName}.
      </DeskMessage>
    );
  }

  const signedIn = auth.status === 'signed-in' && auth.user;
  const wrongAccount = signedIn && auth.user.email !== invitation.email;

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post(`/invitations/${token}/accept`);
      invalidate('workspaces');
      navigate(`/w/${result.workspaceId}`, { replace: true });
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'SyncSpace could not be reached. Try again when you’re online.');
      setBusy(false);
    }
  }

  return (
    <DeskMessage
      title={`Join ${invitation.workspaceName}`}
      action={
        !signedIn ? (
          <>
            <ButtonLink to={`/signin?next=${encodeURIComponent(here)}`} variant="primary">
              Sign in to accept
            </ButtonLink>
            <ButtonLink to={`/register?next=${encodeURIComponent(here)}`}>Create an account</ButtonLink>
          </>
        ) : wrongAccount ? (
          <Button
            onClick={async () => {
              await auth.signOut();
              navigate(`/signin?next=${encodeURIComponent(here)}`);
            }}
          >
            Sign out and switch account
          </Button>
        ) : (
          <Button variant="primary" onClick={accept} disabled={busy}>
            {busy ? 'Joining…' : `Join as ${invitation.role}`}
          </Button>
        )
      }
    >
      <p>
        {invitation.invitedBy ?? 'Someone'} invited <strong className="text-ink">{invitation.email}</strong> to join as{' '}
        {ROLE_WORDS[invitation.role]}. The link works until {shortDateTime(invitation.expiresAt)}.
      </p>
      {wrongAccount && (
        <p className="mt-3 font-semibold text-ink">
          You’re signed in as {auth.user.email}. This invitation is for {invitation.email}.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 font-semibold text-correction">
          {error}
        </p>
      )}
      {!signedIn && (
        <p className="mt-3 text-sm">
          Use the email address above. <Link to="/" className="underline underline-offset-2">What is SyncSpace?</Link>
        </p>
      )}
    </DeskMessage>
  );
}
