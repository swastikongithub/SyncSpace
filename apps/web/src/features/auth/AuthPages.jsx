// Sign in and create an account. One layout route holds both pages, so the light table beside the
// form keeps running while you switch between them, and the shared fields morph into place (View
// Transitions). Styles are hand-written in auth.css. See docs/design.md, "Sign-in pages".
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link, Navigate, Outlet, useLocation, useOutletContext, useSearchParams } from 'react-router';
import { Check, Info, WifiOff } from 'lucide-react';
import { LIMITS } from '@syncspace/shared/limits';
import { useAuth } from '../../app/auth.jsx';
import { ApiError, fieldError, NetworkError } from '../../lib/api.js';
import { useOnline } from '../../lib/online.js';
import { Brand } from '../../ui/Brand.jsx';
import { RegistrationMark } from '../../ui/RegistrationMark.jsx';
import { ThemeMenu } from '../../ui/ThemeMenu.jsx';
import { AuthField, PasswordField } from './AuthFields.jsx';
import { RegistrationTable } from './RegistrationTable.jsx';
import { createAuthStage, registerProgress, signInProgress } from './registration.js';
import './auth.css';

/** How long the copy takes to snap into register before the app opens. */
const SETTLE_MS = 620;

function safeNext(value) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

function useNextSuffix() {
  const [params] = useSearchParams();
  const next = params.get('next');
  return next ? `?next=${encodeURIComponent(safeNext(next))}` : '';
}

function describeAuthError(error) {
  if (error instanceof NetworkError) return 'SyncSpace could not be reached. Check your connection and try again.';
  if (error instanceof ApiError && error.code !== 'validation_failed') return error.message;
  return null;
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const settle = () => new Promise((resolve) => setTimeout(resolve, reducedMotion() ? 0 : SETTLE_MS));

function usePageTitle(title) {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

/**
 * Runs a sign-in or registration: busy while the request is out; once the server accepts, the
 * copy snaps into register before this tab switches to the user, and the layout then opens the
 * app. On failure the copy jolts back out and the error is shown.
 */
function useAuthSubmit(stage, action) {
  const [error, setError] = useState(null);
  const { phase } = useSyncExternalStore(stage.subscribe, stage.get);

  async function submit(event) {
    event.preventDefault();
    if (phase === 'busy' || phase === 'success') return;
    setError(null);
    stage.set({ phase: 'busy' });
    try {
      await action({
        beforeCommit: async () => {
          stage.set({ phase: 'success' });
          await settle();
        },
      });
    } catch (failure) {
      setError(failure);
      stage.jolt();
    }
  }

  return { submit, error, phase };
}

function SubmitButton({ phase, idle, busy, done }) {
  const working = phase === 'busy' || phase === 'success';
  return (
    <button type="submit" className="ss-auth-submit" data-phase={phase} aria-disabled={working || undefined} style={{ viewTransitionName: 'auth-submit' }}>
      <span className="ss-auth-submit-face">
        <span className="ss-auth-submit-label" style={{ viewTransitionName: 'auth-submit-label' }}>
          {phase === 'busy' && <RegistrationMark state="sending" size={20} className="ss-auth-submit-mark" />}
          {phase === 'success' && <Check aria-hidden="true" size={19} strokeWidth={2.75} />}
          {phase === 'busy' ? busy : phase === 'success' ? done : idle}
        </span>
      </span>
    </button>
  );
}

function FormError({ error }) {
  const message = describeAuthError(error);
  if (!message) return null;
  return (
    <p role="alert" className="ss-auth-alert">
      {message}
    </p>
  );
}

function AuthNotice({ tone, icon: Icon, title, children }) {
  return (
    <div role="status" className="ss-auth-notice" data-tone={tone}>
      <Icon aria-hidden="true" size={18} strokeWidth={2.25} />
      <div>
        <p className="ss-auth-notice-title">{title}</p>
        <p>{children}</p>
      </div>
    </div>
  );
}

function AuthSwitch({ mode }) {
  const suffix = useNextSuffix();
  return (
    <nav aria-label="Account" className="ss-auth-switch" data-mode={mode}>
      <span className="ss-auth-switch-thumb" aria-hidden="true" />
      <Link to={`/signin${suffix}`} viewTransition replace aria-current={mode === 'signin' ? 'page' : undefined}>
        Sign in
      </Link>
      <Link to={`/register${suffix}`} viewTransition replace aria-current={mode === 'register' ? 'page' : undefined}>
        Create account
      </Link>
    </nav>
  );
}

/** The route element for /signin and /register: the form column and the light table. */
export function AuthLayout() {
  const auth = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  const mode = location.pathname.startsWith('/register') ? 'register' : 'signin';
  const [stage] = useState(() => createAuthStage({ mode }));

  // Signed in (already, or just now on this page once the table has settled): open the app.
  if (auth.status === 'signed-in') return <Navigate to={safeNext(params.get('next'))} replace />;

  return (
    <div className="ss-auth">
      <header className="ss-auth-bar">
        <Brand />
        <ThemeMenu />
      </header>
      <main id="main" className="ss-auth-main">
        <div className="ss-auth-column">
          <AuthSwitch mode={mode} />
          <Outlet context={stage} />
        </div>
      </main>
      <footer className="ss-auth-foot">
        <p>
          New to SyncSpace? <Link to="/">See how it works</Link>
        </p>
      </footer>
      <RegistrationTable stage={stage} />
    </div>
  );
}

function useStageForm(stage, mode, progress) {
  useEffect(() => {
    stage.set({ mode, phase: 'idle' });
  }, [stage, mode]);
  useEffect(() => {
    stage.set({ progress });
  }, [stage, progress]);
}

export function SignInPage() {
  const auth = useAuth();
  const online = useOnline();
  const stage = useOutletContext();
  const [email, setEmail] = useState(auth.endedFor?.email ?? '');
  const [password, setPassword] = useState('');
  useStageForm(stage, 'signin', signInProgress({ email, password }));
  const { submit, error, phase } = useAuthSubmit(stage, (options) => auth.signIn({ email, password }, options));
  usePageTitle('Sign in to SyncSpace');

  const demoAccounts = import.meta.env.VITE_DEMO_ACCOUNTS ? JSON.parse(import.meta.env.VITE_DEMO_ACCOUNTS) : null;

  return (
    <>
      <div className="ss-auth-heading">
        <h1 style={{ viewTransitionName: 'auth-title' }}>Sign in to SyncSpace</h1>
        <p style={{ viewTransitionName: 'auth-lede' }}>Documents kept on this device open as soon as you’re in, even offline.</p>
      </div>

      {(auth.serverSignOutPending || auth.endedFor || !online) && (
        <div className="ss-auth-notices">
          {auth.serverSignOutPending && (
            <AuthNotice tone="carbon" icon={Info} title="Signed out on this device">
              You were offline, so the server hasn’t ended your session yet. SyncSpace ends it automatically the next time this
              browser is online.
            </AuthNotice>
          )}
          {auth.endedFor && (
            <AuthNotice tone="carbon" icon={Info} title="Your session ended">
              Sign in again as {auth.endedFor.name} to send any changes saved on this device.
            </AuthNotice>
          )}
          {!online && (
            <AuthNotice tone="caution" icon={WifiOff} title="You’re offline">
              Signing in needs a connection. Documents already saved on this device open once you’re signed in.
            </AuthNotice>
          )}
        </div>
      )}

      <form className="ss-auth-form" onSubmit={submit} noValidate>
        <AuthField
          name="email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="next"
          maxLength={LIMITS.emailMax}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldError(error, 'email')}
          required
        />
        <PasswordField
          autoComplete="current-password"
          enterKeyHint="go"
          maxLength={LIMITS.passwordMax}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={fieldError(error, 'password')}
          required
        />
        <FormError error={error} />
        <SubmitButton phase={phase} idle="Sign in" busy="Signing in…" done="Signed in" />
      </form>

      {demoAccounts && (
        <section className="ss-auth-demo" aria-labelledby="ss-auth-demo-title">
          <h2 id="ss-auth-demo-title">Demo accounts</h2>
          <ul>
            {demoAccounts.map((account) => (
              <li key={account.email}>
                <button
                  type="button"
                  onClick={() => {
                    setEmail(account.email);
                    setPassword(account.password);
                  }}
                >
                  <span>{account.label}</span>
                  <span>{account.email}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export function RegisterPage() {
  const auth = useAuth();
  const stage = useOutletContext();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  useStageForm(stage, 'register', registerProgress(form, LIMITS.passwordMin));
  const { submit, error, phase } = useAuthSubmit(stage, (options) => auth.register(form, options));
  usePageTitle('Create a SyncSpace account');

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const remaining = LIMITS.passwordMin - form.password.length;

  return (
    <>
      <div className="ss-auth-heading">
        <h1 style={{ viewTransitionName: 'auth-title' }}>Create your account</h1>
        <p style={{ viewTransitionName: 'auth-lede' }}>Start a workspace, then invite the people you write with.</p>
      </div>

      <form className="ss-auth-form" onSubmit={submit} noValidate>
        <AuthField
          name="name"
          label="Your name"
          autoComplete="name"
          enterKeyHint="next"
          maxLength={LIMITS.userNameMax}
          value={form.name}
          onChange={set('name')}
          error={fieldError(error, 'name')}
          hint="Shown to people you write with."
          required
        />
        <AuthField
          name="email"
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="next"
          maxLength={LIMITS.emailMax}
          value={form.email}
          onChange={set('email')}
          error={fieldError(error, 'email')}
          required
        />
        <PasswordField
          autoComplete="new-password"
          enterKeyHint="go"
          maxLength={LIMITS.passwordMax}
          minLength={LIMITS.passwordMin}
          value={form.password}
          onChange={set('password')}
          error={fieldError(error, 'password')}
          hint={
            form.password.length === 0
              ? `At least ${LIMITS.passwordMin} characters. A short phrase works well.`
              : remaining > 0
                ? `${remaining} more ${remaining === 1 ? 'character' : 'characters'}.`
                : 'Long enough.'
          }
          required
        />
        <FormError error={error} />
        <SubmitButton phase={phase} idle="Create account" busy="Creating your account…" done="Account created" />
      </form>
    </>
  );
}
