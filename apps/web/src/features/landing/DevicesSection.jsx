// "On a laptop and a phone": real screenshots of the app, and the place where a Spline scene of
// the same devices is shown when one has been published (VITE_SPLINE_SCENE_URL). Without a scene
// URL nothing from Spline is downloaded and the screenshots are the section. See
// docs/landing-page-design.md, "Spline".
import { Component, lazy, Suspense, useEffect, useRef, useState } from 'react';

// Replaced at build time (vite.config.js): with no scene configured, the Spline code is not built.
const SPLINE_SCENE_URL = import.meta.env.VITE_SPLINE_SCENE_URL;
const SplineDesk = SPLINE_SCENE_URL ? lazy(() => import('./SplineDesk.jsx')) : null;

class SceneBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    console.warn('The Spline scene could not be loaded; showing screenshots instead.', error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Screenshots() {
  return (
    <div className="ss-devices-proofs">
      <figure className="ss-proof ss-proof-laptop">
        <img
          src="/landing/laptop-editor.webp"
          width="1440"
          height="900"
          loading="lazy"
          decoding="async"
          alt="SyncSpace on a laptop: a document open for editing, with a collaborator’s named caret and the Copies panel listing this device, the server and the people here now."
        />
        <figcaption>On a laptop: the document, and every copy’s state beside it.</figcaption>
      </figure>
      <figure className="ss-proof ss-proof-phone">
        <img
          src="/landing/phone-editor.webp"
          width="780"
          height="1688"
          loading="lazy"
          decoding="async"
          alt="SyncSpace on a phone: the same editor with its formatting toolbar and the sync status in the header."
        />
        <figcaption>On a phone: the same editor, the same status.</figcaption>
      </figure>
    </div>
  );
}

/** Mounts the Spline scene only when the section is about to be seen. */
function SplineSlot() {
  const ref = useRef(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && setNear(true), {
      rootMargin: '50% 0px',
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="ss-devices-scene">
      {near ? (
        <SceneBoundary fallback={<Screenshots />}>
          <Suspense fallback={<Screenshots />}>
            <SplineDesk scene={SPLINE_SCENE_URL} />
          </Suspense>
        </SceneBoundary>
      ) : (
        <Screenshots />
      )}
    </div>
  );
}

export function DevicesSection() {
  return (
    <section id="devices" aria-labelledby="devices-title" className="ss-devices">
      <div className="ss-band-inner">
        <h2 id="devices-title" className="ss-h2">
          The same page on a laptop and a phone.
        </h2>
        <p className="ss-devices-lede">
          SyncSpace runs in the browser on both, and keeps working when either one drops off the network.
          {SPLINE_SCENE_URL ? '' : ' These are screenshots of the app as it is today.'}
        </p>
        {SPLINE_SCENE_URL ? <SplineSlot /> : <Screenshots />}
      </div>
    </section>
  );
}
