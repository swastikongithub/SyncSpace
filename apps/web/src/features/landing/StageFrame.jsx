// Hosts the light table. Decides whether the 3D scene runs at all, loads it only when the stage
// is about to be seen, pauses it while off screen, and keeps the SVG poster underneath as the
// loading state and as the fallback when WebGPU and WebGL are missing or fail.
import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { StagePoster } from './StagePoster.jsx';

const LightTable = lazy(() => import('./three/LightTable.jsx'));

/** Why the 3D scene is not running, in words for the stage's status line. */
const POSTER_REASONS = {
  unsupported: 'This browser has neither WebGPU nor WebGL 2, so the table is drawn as a still.',
  failed: 'The 3D renderer could not start on this device, so the table is drawn as a still.',
  lost: 'The graphics device was lost, so the table is drawn as a still.',
  'save-data': 'Data saver is on, so the 3D table has not been downloaded.',
  requested: 'The 3D table is turned off for this visit.',
};

function webgl2Available() {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2');
    context?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(context);
  } catch {
    return false;
  }
}

/** The tier this visit should start with. `?stage=poster` and `?renderer=webgl` exist for comparison and testing. */
function initialTier() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('stage') === 'poster') return { tier: 'poster', reason: 'requested' };
  if (navigator.connection?.saveData) return { tier: 'poster', reason: 'save-data' };
  const forceWebGL = params.get('renderer') === 'webgl';
  if (!forceWebGL && navigator.gpu) return { tier: '3d', forceWebGL: false };
  if (webgl2Available()) return { tier: '3d', forceWebGL: true };
  return { tier: 'poster', reason: 'unsupported' };
}

class RendererBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return reduced;
}

/**
 * @param {{ store: ReturnType<import('./stage-store.js').createStageStore>, label: string, children?: React.ReactNode }} props
 */
export function StageFrame({ store, label, children }) {
  const frameRef = useRef(null);
  const [start] = useState(initialTier);
  const [tier, setTier] = useState(start.tier); // '3d' | 'poster'
  const [reason, setReason] = useState(start.reason ?? null);
  const [mounted, setMounted] = useState(false); // 3D chunk requested
  const [backend, setBackend] = useState(null); // 'webgpu' | 'webgl2' once the first frame is drawn
  const reducedMotion = useReducedMotion();
  const motionRef = useRef(!reducedMotion);
  const activeRef = useRef(true);
  const invalidateRef = useRef(null);
  const frames = useRef(0);

  useEffect(() => {
    motionRef.current = !reducedMotion;
  }, [reducedMotion]);

  // Load the scene once the stage is within a screen of the viewport, after the page has painted.
  useEffect(() => {
    if (tier !== '3d' || mounted) return undefined;
    const element = frameRef.current;
    let idle = null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        const begin = () => setMounted(true);
        idle = 'requestIdleCallback' in window ? window.requestIdleCallback(begin, { timeout: 900 }) : window.setTimeout(begin, 200);
      },
      { rootMargin: '100% 0px' },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (idle !== null) ('cancelIdleCallback' in window ? window.cancelIdleCallback(idle) : window.clearTimeout(idle));
    };
  }, [tier, mounted]);

  // Render frames only while the stage is on screen and the tab is visible.
  useEffect(() => {
    const element = frameRef.current;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      activeRef.current = visible && document.visibilityState === 'visible';
      element.dataset.active = String(activeRef.current);
      if (activeRef.current) invalidateRef.current?.();
    });
    observer.observe(element);
    const onVisibility = () => {
      activeRef.current = document.visibilityState === 'visible' && element.dataset.active !== 'false';
      if (activeRef.current) invalidateRef.current?.();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const fallBack = useCallback((why) => {
    setTier('poster');
    setReason(why);
    setBackend(null);
  }, []);

  const onReady = useCallback(
    (name, state) => {
      invalidateRef.current = state.invalidate;
      // A lost device or context is not recoverable here: return to the still.
      state.gl.onDeviceLost = () => fallBack('lost');
      frames.current = 0;
      setBackend(name);
    },
    [fallBack],
  );

  const onFrame = useCallback(() => {
    frames.current += 1;
    if (frameRef.current) frameRef.current.dataset.frames = String(frames.current);
  }, []);

  const small = typeof window !== 'undefined' && window.innerWidth < 640;
  const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  const rendererName = tier === 'poster' ? 'poster' : backend ?? 'loading';

  return (
    <figure ref={frameRef} className="ss-stage" data-renderer={rendererName} aria-label={label}>
      <div className={`ss-stage-poster ${backend && tier === '3d' ? 'is-covered' : ''}`}>
        <StagePoster store={store} />
      </div>
      {tier === '3d' && mounted && (
        <div className={`ss-stage-canvas ${backend ? 'is-ready' : ''}`} aria-hidden="true">
          <RendererBoundary onError={() => fallBack('failed')}>
            <Suspense fallback={null}>
              <LightTable
                store={store}
                forceWebGL={Boolean(start.forceWebGL)}
                activeRef={activeRef}
                motionRef={motionRef}
                onReady={onReady}
                onFrame={onFrame}
                maxDpr={coarse ? 1.5 : 1.75}
                pitch={small ? 0.0155 : 0.0125}
                framing={small ? 'sheets' : 'pad'}
              />
            </Suspense>
          </RendererBoundary>
        </div>
      )}
      {children}
      {tier === 'poster' && reason && reason !== 'requested' && <p className="ss-stage-note">{POSTER_REASONS[reason]}</p>}
      {tier === 'poster' && reason === 'save-data' && (
        <button
          type="button"
          className="ss-stage-load"
          onClick={() => {
            setReason(null);
            setTier('3d');
          }}
        >
          Load the 3D table
        </button>
      )}
    </figure>
  );
}
