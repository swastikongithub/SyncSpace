import { Navigate, Outlet, ScrollRestoration, useLocation, useRouteError } from 'react-router';
import { deviceMemory } from '../lib/device-memory.js';
import { SessionEndedDialog } from '../features/account/SessionEndedDialog.jsx';
import { Brand } from '../ui/Brand.jsx';
import { ButtonLink } from '../ui/Button.jsx';
import { useAuth } from './auth.jsx';
import { UpdatePrompt } from './UpdatePrompt.jsx';

export function RootLayout() {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-sheet px-4 py-2 font-semibold text-ink shadow-sheet focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <Outlet />
      <SessionEndedDialog />
      <UpdatePrompt />
      <ScrollRestoration />
    </>
  );
}

/** A quiet full-page state on the desk (loading, not found, errors). */
export function DeskMessage({ title, children, action }) {
  return (
    <main id="main" className="grid min-h-dvh place-items-center bg-desk px-5 py-10">
      <div className="flex w-full max-w-md flex-col items-start gap-5">
        <Brand />
        <div className="w-full rounded-lg bg-sheet p-6 shadow-sheet">
          <h1 className="text-xl font-bold">{title}</h1>
          {children && <div className="mt-2 text-graphite">{children}</div>}
          {action && <div className="mt-5 flex flex-wrap gap-2">{action}</div>}
        </div>
      </div>
    </main>
  );
}

export function RequireUser() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'checking' && !auth.user) {
    return <DeskMessage title="Opening SyncSpace…" />;
  }
  if (auth.status === 'signed-out' || !auth.user) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/signin?next=${next}`} replace />;
  }
  return <Outlet />;
}

export function Home() {
  const auth = useAuth();
  if (auth.status === 'checking' && !auth.user) return <DeskMessage title="Opening SyncSpace…" />;
  if (!auth.user || auth.status === 'signed-out') return <Navigate to="/signin" replace />;
  const last = deviceMemory.lastWorkspace(auth.user.id);
  return <Navigate to={last ? `/w/${last}` : '/w'} replace />;
}

export function NotFound() {
  return (
    <DeskMessage title="There’s nothing at this address" action={<ButtonLink to="/" variant="primary">Go to your workspaces</ButtonLink>}>
      The link may be mistyped, or the page may have moved.
    </DeskMessage>
  );
}

export function RouteError() {
  const error = useRouteError();
  const chunkFailed = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    error?.message ?? '',
  );
  const offlineChunk = chunkFailed && navigator.onLine === false;
  return (
    <DeskMessage
      title={
        offlineChunk
          ? 'This part of SyncSpace isn’t on this device yet'
          : chunkFailed
            ? 'This part of SyncSpace didn’t finish loading'
            : 'Something went wrong on this page'
      }
      action={
        <button type="button" onClick={() => window.location.reload()} className="font-semibold text-carbon underline underline-offset-2">
          Reload the page
        </button>
      }
    >
      {offlineChunk
        ? 'It hasn’t been downloaded yet and you appear to be offline. Reconnect and reload.'
        : chunkFailed
          ? 'The app may have just been updated. Reload to get the latest version.'
          : 'Your documents are safe: edits are saved on this device as you type. Reloading usually fixes this.'}
    </DeskMessage>
  );
}
