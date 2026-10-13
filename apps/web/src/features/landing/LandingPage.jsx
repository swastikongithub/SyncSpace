// The public landing page. Its HTML carries everything a visitor needs (what SyncSpace is, how
// it behaves offline, a live demo, how to start); the light table beside it illustrates the same
// story and is loaded only when it can run. See docs/landing-page-design.md.
import { lazy, Suspense, useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { Brand } from '../../ui/Brand.jsx';
import { ButtonLink } from '../../ui/Button.jsx';
import { RegistrationMark } from '../../ui/RegistrationMark.jsx';
import { DevicesSection } from './DevicesSection.jsx';
import { createStageStore } from './stage-store.js';
import { StageFrame } from './StageFrame.jsx';
import './landing.css';

const ReplicaDemo = lazy(() => import('../auth/ReplicaDemo.jsx'));

const REPOSITORY = 'https://github.com/swastikongithub/SyncSpace';

const CAPTIONS = {
  hero: 'Four copies of one document: the server’s, yours in violet, Ana’s in rose and Ben’s in blue. In register, they print as one page.',
  together: 'Ana and Ben type at the same time. Each line prints on every copy as it is typed.',
  offline: 'Your copy is offline: lifted out of register, with your new paragraph in wet ink. Ana’s new paragraph is on every other copy.',
  stored: 'Reconnected. Your paragraph reaches the server first and dries once it is stored, then prints on Ana’s and Ben’s copies.',
  history: 'Earlier versions of the server’s copy, kept as proofs above the table.',
  try: 'The demo’s three copies, drawn live. A device taken offline lifts out of register, and its unsent lines are wet ink.',
};

/** Marks the chapter whose section crosses the middle of the viewport as the stage's chapter. */
function useChapterTracking(store) {
  useEffect(() => {
    const sections = [...document.querySelectorAll('[data-chapter]')];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) store.set({ chapter: entry.target.dataset.chapter });
        }
      },
      { rootMargin: '-52% 0px -44% 0px' },
    );
    sections.forEach((section) => observer.observe(section));
    const onScroll = () => {
      if (window.scrollY < 80) store.set({ chapter: 'hero' });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, [store]);
}

function StageCaption({ store }) {
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  return (
    <figcaption className="ss-stage-caption">
      <p>{CAPTIONS[state.chapter] ?? CAPTIONS.hero}</p>
      {state.chapter === 'hero' && (
        <button type="button" className="ss-stage-control" aria-pressed={state.pulled} onClick={() => store.set({ pulled: !state.pulled })}>
          {state.pulled ? 'Let my copy sync back' : 'Pull my copy out of register'}
        </button>
      )}
    </figcaption>
  );
}

function Header() {
  return (
    <header className="ss-landing-header">
      <div className="ss-landing-bar">
        <Brand />
        <nav aria-label="Page sections" className="ss-landing-nav">
          <a href="#offline">Offline</a>
          <a href="#how">How it works</a>
          <a href="#try">Try it</a>
        </nav>
        <div className="ss-landing-actions">
          <Link to="/signin" className="ss-landing-signin">
            Sign in
          </Link>
          <ButtonLink to="/register" variant="primary" size="sm">
            Create an account
          </ButtonLink>
        </div>
      </div>
    </header>
  );
}

function StatusSample({ state, children }) {
  return (
    <p className="ss-status-sample">
      <RegistrationMark state={state} size={22} />
      <span>{children}</span>
    </p>
  );
}

function Chapter({ id, chapter, title, children }) {
  return (
    <section id={id} data-chapter={chapter} aria-labelledby={`${id}-title`} className="ss-chapter">
      <h2 id={`${id}-title`} className="ss-h2">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Footer() {
  return (
    <footer className="ss-landing-footer">
      <div className="ss-landing-footer-inner">
        <div className="ss-footer-brand">
          <Brand />
          <p>Shared documents that keep working offline.</p>
        </div>
        <nav aria-label="Footer" className="ss-footer-links">
          <Link to="/register">Create an account</Link>
          <Link to="/signin">Sign in</Link>
          <a href="#try">Try the demo</a>
          <a href="#how">How it works</a>
          <a href={REPOSITORY}>Source code on GitHub</a>
        </nav>
        <Colophon />
      </div>
    </footer>
  );
}

/** Says what the light table is drawn with on this device, read from the stage itself. */
function Colophon() {
  const renderer = useSyncExternalStore(subscribeRenderer, readRenderer, () => 'loading');
  const drawnWith = {
    webgpu: 'On this device it is rendering with WebGPU.',
    webgl2: 'On this device it is rendering with WebGL 2, because WebGPU is not available here.',
    poster: 'On this device it is shown as a still SVG drawing.',
    loading: 'It loads once the page has painted.',
  }[renderer];
  return (
    <p className="ss-colophon">
      The light table on this page is drawn with three.js and React Three Fiber, using shaders written in three.js’s shading
      language. {drawnWith} SyncSpace itself is built with React, Node.js, Express, MongoDB and Yjs.
    </p>
  );
}

function subscribeRenderer(callback) {
  const observer = new MutationObserver(callback);
  const attach = () => {
    const stage = document.querySelector('.ss-stage');
    if (stage) observer.observe(stage, { attributes: true, attributeFilter: ['data-renderer'] });
    return stage;
  };
  if (!attach()) requestAnimationFrame(() => attach() && callback());
  return () => observer.disconnect();
}

function readRenderer() {
  return document.querySelector('.ss-stage')?.dataset.renderer ?? 'loading';
}

export function LandingPage() {
  const store = useMemo(() => createStageStore(), []);
  useChapterTracking(store);
  const onDemoState = useCallback((demo) => store.set({ demo }), [store]);

  useEffect(() => {
    const previous = document.title;
    document.title = 'SyncSpace: shared documents that keep working offline';
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="ss-landing">
      <Header />
      <main id="main">
        <div className="ss-story">
          <section data-chapter="hero" aria-labelledby="hero-title" className="ss-hero">
            <h1 id="hero-title" className="ss-h1">
              <span className="ss-h1-ink">Write together, even when the connection drops.</span>
              <span className="ss-h1-plate" aria-hidden="true">
                Write together, even when the connection drops.
              </span>
            </h1>
            <p className="ss-lede">
              SyncSpace is a shared document editor where every device keeps its own copy of the page. Writing never waits for the
              network, and when a device reconnects, its copy merges with everyone else’s: edits are combined, not replaced.
            </p>
            <div className="ss-hero-actions">
              <ButtonLink to="/register" variant="primary">
                Create an account
              </ButtonLink>
              <ButtonLink to="/signin" variant="outline">
                Sign in
              </ButtonLink>
              <a href="#try" className="ss-text-link">
                Try it without an account
              </a>
            </div>
          </section>

          <div className="ss-story-stage">
            <StageFrame store={store} label="Illustration: copies of one document as translucent sheets on a light table">
              <StageCaption store={store} />
            </StageFrame>
          </div>

          <div className="ss-chapters">
            <Chapter id="together" chapter="together" title="Everyone on the same page, at the same time.">
              <p>
                Open a document and everyone in it is listed under <em>Here now</em>, with their name on their caret. Each
                keystroke reaches the others as it happens, and nobody’s typing overwrites anyone else’s: SyncSpace merges every
                edit with Yjs, a data type built so that copies edited at the same time always end up identical.
              </p>
              <p>Owners manage the workspace, editors write, and viewers follow along live without being able to change anything.</p>
            </Chapter>

            <Chapter id="offline" chapter="offline" title="Lose the connection. Keep the sentence.">
              <p>
                Every edit is saved on your device as you type, in this browser’s own storage. Documents you have opened before
                stay editable offline, even after a reload, and SyncSpace counts exactly how many of your edits the server has not
                received yet.
              </p>
              <StatusSample state="held">
                <strong>Saved on this device only.</strong> 3 edits from this device haven’t reached the server yet.
              </StatusSample>
              <p>Paragraphs holding unsent edits carry a mark in the margin until the server has them.</p>
            </Chapter>

            <Chapter id="stored" chapter="stored" title="Back online, back in register.">
              <p>
                When the connection returns, your copy and the server’s exchange exactly what the other is missing, so the edits
                made on both sides survive. Your device says <em>Stored on server</em> only after the server has written the change
                to its database, not when it was merely sent.
              </p>
              <StatusSample state="register">
                <strong>Stored on server.</strong> Has all your changes.
              </StatusSample>
              <p>
                If someone deleted a paragraph you were editing offline, your version is saved in the document’s history and you are
                told, so nothing disappears silently.
              </p>
            </Chapter>

            <Chapter id="history" chapter="history" title="Every version, and a way back.">
              <p>
                SyncSpace keeps versions as you work, and you can name the ones that matter. Preview any version read-only, then
                restore it as a new change that collaborators see live. The text from just before every restore is kept too, so a
                restore can itself be undone.
              </p>
            </Chapter>

            <section id="try" data-chapter="try" aria-labelledby="try-title" className="ss-chapter ss-try">
              <h2 id="try-title" className="ss-h2">
                Try it: one page, three copies.
              </h2>
              <p>
                Type in either device, take one offline, keep typing in both, then reconnect. This runs Yjs, the same merging
                engine as SyncSpace, entirely in this page. Nothing you type is sent anywhere.
              </p>
              <Suspense fallback={<div className="ss-demo-placeholder" aria-hidden="true" />}>
                <ReplicaDemo onState={onDemoState} />
              </Suspense>
            </section>
          </div>
        </div>

        <section id="workspace" aria-labelledby="workspace-title" className="ss-band">
          <div className="ss-band-inner">
            <h2 id="workspace-title" className="ss-h2">
              What’s in a workspace
            </h2>
            <dl className="ss-features">
              <div>
                <dt>People and roles</dt>
                <dd>
                  Invite people as owners, editors or viewers. Invitation links work once, expire, and only for the email address
                  they were made for. Role changes apply to open documents immediately.
                </dd>
              </div>
              <div>
                <dt>Documents</dt>
                <dd>Headings, lists, checklists, quotes, code and links. Pin what matters, rename freely, and restore anything from the trash.</dd>
              </div>
              <div>
                <dt>Search</dt>
                <dd>
                  Find documents by title or text across your workspaces with Ctrl K (⌘ K on a Mac). Offline, search covers the titles
                  of documents on your device.
                </dd>
              </div>
              <div>
                <dt>Activity</dt>
                <dd>A short record of who joined, what was created, and who restored which version.</dd>
              </div>
              <div>
                <dt>Signing out with unsent work</dt>
                <dd>
                  If you sign out before some edits reached the server, SyncSpace lists those documents and lets you keep the edits
                  on the device, to be sent after you next sign in, or erase them.
                </dd>
              </div>
              <div>
                <dt>An app on your device</dt>
                <dd>In browsers that support it, install SyncSpace from the address bar. Once installed, it opens without a connection.</dd>
              </div>
            </dl>
          </div>
        </section>

        <DevicesSection />

        <section id="how" aria-labelledby="how-title" className="ss-band ss-how">
          <div className="ss-band-inner">
            <h2 id="how-title" className="ss-h2">
              How a keystroke becomes stored
            </h2>
            <ol className="ss-steps">
              <li>
                <strong>Saved on your device.</strong> The edit is written to the browser’s IndexedDB storage the moment the editor
                receives it.
              </li>
              <li>
                <strong>Sent to the server.</strong> Your device sends the change over a WebSocket, numbered so it can be
                acknowledged.
              </li>
              <li>
                <strong>Shared at once.</strong> The server passes it to everyone else in the document straight away.
              </li>
              <li>
                <strong>Written to MongoDB.</strong> The server appends the change to the document’s log in the database.
              </li>
              <li>
                <strong>Acknowledged.</strong> Only now does your device count the change as stored on the server.
              </li>
            </ol>
            <p className="ss-how-note">
              Offline, steps two to five wait. On reconnecting, your device and the server compare what each already has and send
              only the difference, deletions included. The full design, its tests and its known limitations are described in the{' '}
              <a href={`${REPOSITORY}#readme`}>project’s README</a>.
            </p>
          </div>
        </section>

        <section aria-labelledby="start-title" className="ss-start">
          <div className="ss-band-inner">
            <h2 id="start-title" className="ss-h2">
              Start a workspace.
            </h2>
            <p>Create an account, make a workspace, and invite the people you write with.</p>
            <div className="ss-hero-actions">
              <ButtonLink to="/register" variant="primary">
                Create an account
              </ButtonLink>
              <ButtonLink to="/signin" variant="outline">
                Sign in
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
