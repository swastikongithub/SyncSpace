import { lazy, Suspense, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { WifiOff } from 'lucide-react';
import { useAuth } from '../../app/auth.jsx';
import { ApiError, fieldError, NetworkError } from '../../lib/api.js';
import { useOnline } from '../../lib/online.js';
import { Brand } from '../../ui/Brand.jsx';
import { ThemeMenu } from '../../ui/ThemeMenu.jsx';
import { Button } from '../../ui/Button.jsx';
import { Notice } from '../../ui/Notice.jsx';
import { TextField } from '../../ui/TextField.jsx';

const ReplicaDemo = lazy(() => import('./ReplicaDemo.jsx'));

function safeNext(value) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

function AuthLayout({ children }) {
  return (
    <div className="min-h-dvh bg-desk">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-16 lg:py-14">
        <main id="main" className="flex flex-col gap-8">
          <div className="flex items-center justify-between gap-3">
            <Brand />
            <ThemeMenu />
          </div>
          <div className="flex flex-col gap-3">
            <h1 className="font-writing text-[2.1rem] font-[620] leading-[1.12] tracking-[-0.015em] sm:text-[2.5rem]">
              Shared documents that keep working offline.
            </h1>
            <p className="max-w-prose text-[1.05rem] leading-relaxed text-graphite">
              Everyone edits the same page. When a connection drops, writing continues on that device, and every copy merges
              when it comes back: edits are combined, not replaced.
            </p>
          </div>
          {children}
        </main>
        <aside aria-labelledby="demo-heading" className="flex flex-col gap-4">
          <div>
            <h2 id="demo-heading" className="text-lg font-bold">
              Try it: one page, three copies
            </h2>
            <p className="text-sm text-graphite">
              Type in either device, take one offline, keep typing in both, then reconnect.
            </p>
          </div>
          <Suspense fallback={<div className="h-[34rem] rounded-lg border border-dashed border-rule" aria-hidden="true" />}>
            <ReplicaDemo />
          </Suspense>
        </aside>
      </div>
    </div>
  );
}

function describeAuthError(error) {
  if (error instanceof NetworkError) return 'SyncSpace could not be reached. Check your connection and try again.';
  if (error instanceof ApiError && error.code !== 'validation_failed') return error.message;
  return null;
}

export function SignInPage() {
  const auth = useAuth();
  const online = useOnline();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [email, setEmail] = useState(auth.endedFor?.email ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (auth.status === 'signed-in') return <Navigate to={next} replace />;

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.signIn({ email, password });
      navigate(next, { replace: true });
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  const demoAccounts = import.meta.env.VITE_DEMO_ACCOUNTS ? JSON.parse(import.meta.env.VITE_DEMO_ACCOUNTS) : null;

  return (
    <AuthLayout>
      <div className="flex flex-col gap-4">
        {auth.serverSignOutPending && (
          <Notice tone="carbon" title="Signed out on this device">
            You were offline, so the server hasn’t ended your session yet. SyncSpace ends it automatically the next time this
            browser is online.
          </Notice>
        )}
        {auth.endedFor && (
          <Notice tone="carbon" title="Your session ended">
            Sign in again as {auth.endedFor.name} to send any changes saved on this device.
          </Notice>
        )}
        {!online && (
          <Notice tone="caution" icon={WifiOff} title="You’re offline">
            Signing in needs a connection. Documents already saved on this device open once you’re signed in.
          </Notice>
        )}
        <form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-lg bg-sheet p-6 shadow-sheet">
          <h2 className="text-xl font-bold">Sign in</h2>
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={fieldError(error, 'email')}
            required
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fieldError(error, 'password')}
            required
          />
          {describeAuthError(error) && (
            <p role="alert" className="text-sm font-semibold text-correction">
              {describeAuthError(error)}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          <p className="text-sm text-graphite">
            New to SyncSpace?{' '}
            <Link to={`/register${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-carbon underline underline-offset-2">
              Create an account
            </Link>
          </p>
        </form>
        {demoAccounts && (
          <div className="rounded-lg border border-dashed border-rule-strong p-4 text-sm">
            <p className="font-semibold">Demo accounts</p>
            <ul className="mt-1 flex flex-col gap-1 text-graphite">
              {demoAccounts.map((account) => (
                <li key={account.email}>
                  <button
                    type="button"
                    className="text-left underline underline-offset-2 hover:text-ink"
                    onClick={() => {
                      setEmail(account.email);
                      setPassword(account.password);
                    }}
                  >
                    {account.label}: {account.email}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (auth.status === 'signed-in') return <Navigate to={next} replace />;

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.register(form);
      navigate(next, { replace: true });
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-lg bg-sheet p-6 shadow-sheet">
        <h2 className="text-xl font-bold">Create an account</h2>
        <TextField label="Your name" autoComplete="name" value={form.name} onChange={set('name')} error={fieldError(error, 'name')} hint="Shown to people you write with." required />
        <TextField label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={fieldError(error, 'email')} required />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={set('password')}
          error={fieldError(error, 'password')}
          hint="At least 10 characters. A short phrase works well."
          required
        />
        {describeAuthError(error) && (
          <p role="alert" className="text-sm font-semibold text-correction">
            {describeAuthError(error)}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Creating your account…' : 'Create account'}
        </Button>
        <p className="text-sm text-graphite">
          Already have an account?{' '}
          <Link to={`/signin${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-semibold text-carbon underline underline-offset-2">
            Sign in
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
