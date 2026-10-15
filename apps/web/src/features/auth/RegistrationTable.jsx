// The light table beside the sign-in form. The canvas is decoration (aria-hidden); the words
// beside it say what it shows. Without WebGL 2 the same two sheets are drawn as a still SVG.
import { useEffectEvent, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { onThemeChange } from '../../app/theme.js';
import { RegistrationMark } from '../../ui/RegistrationMark.jsx';
import { createRegistrationTable } from './registration-gl.js';
import { describeTable, restingPose } from './registration.js';

const COMPACT = '(max-width: 63.99rem)';
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** The two sheets as a still drawing, posed like the live table. */
function TableStill({ pose }) {
  const rows = [0.56, 0, 1, 0.97, 0.99, 0.94, 0.48, 0, 1, 0.95, 0.98, 0.63, 0, 0.99, 0.96, 0.36];
  const sheet = (ink, printed) => (
    <>
      <rect x="-90" y="-119" width="180" height="238" rx="4" fill="none" stroke={ink} strokeOpacity="0.45" />
      {rows.map((length, index) =>
        length && index / rows.length < printed ? (
          <rect key={index} x="-63" y={-81 + index * 9.8} width={126 * length} height={index === 0 ? 6 : 4.4} rx="1" fill={ink} fillOpacity="0.55" />
        ) : null,
      )}
      {[
        [0, -102],
        [0, 102],
        [-77, 0],
        [77, 0],
      ].map(([x, y]) => (
        <g key={`${x},${y}`} stroke={ink} strokeWidth="0.9" fill="none">
          <circle cx={x} cy={y} r="5" />
          <path d={`M${x - 9} ${y}h18M${x} ${y - 9}v18`} />
        </g>
      ))}
    </>
  );
  return (
    <svg className="ss-auth-still" viewBox="-160 -150 320 300" aria-hidden="true">
      <g>{sheet('var(--table-film-ink)', 1)}</g>
      <g
        className="ss-auth-still-mine"
        style={{ transform: `translate(${pose.x * 0.5}px, ${pose.y * 0.5}px) rotate(${pose.angle}rad)` }}
      >
        {sheet(pose.wet > 0.5 ? 'var(--table-wet-ink)' : 'var(--table-ink)', pose.printed)}
      </g>
    </svg>
  );
}

/** @param {{ stage: ReturnType<typeof import('./registration.js').createAuthStage> }} props */
export function RegistrationTable({ stage }) {
  const state = useSyncExternalStore(stage.subscribe, stage.get);
  const canvasRef = useRef(null);
  const tableRef = useRef(null);
  const copyRef = useRef(null);
  const [still, setStill] = useState(false);
  const fallBack = useEffectEvent(() => setStill(true));

  // Layout effect: the first frame is drawn before the page paints, so the glass never flashes.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const panel = tableRef.current;
    if (!canvas || !panel) return undefined;
    const motion = window.matchMedia(REDUCED_MOTION);
    const compact = window.matchMedia(COMPACT);
    const table = createRegistrationTable(canvas, { reducedMotion: motion.matches, onLost: () => fallBack() });
    if (!table) {
      fallBack();
      return undefined;
    }

    const layout = () => {
      const copy = copyRef.current;
      const reserveBottom = compact.matches || !copy ? 0 : canvas.getBoundingClientRect().bottom - copy.getBoundingClientRect().top + 8;
      table.setLayout({ compact: compact.matches, reserveBottom });
    };
    let jolts = stage.get().jolts;
    const pose = () => {
      const current = stage.get();
      table.setPose(restingPose(current), { jolt: current.jolts !== jolts });
      jolts = current.jolts;
    };
    layout();
    pose();

    const resized = new ResizeObserver(layout);
    resized.observe(canvas);
    if (copyRef.current) resized.observe(copyRef.current);
    const unsubscribe = stage.subscribe(pose);
    const unTheme = onThemeChange(() => table.refreshPalette());
    const motionChanged = () => table.setReducedMotion(motion.matches);
    motion.addEventListener('change', motionChanged);
    compact.addEventListener('change', layout);

    // The copy leans toward a fine pointer moving over the table (never on touch).
    const fine = window.matchMedia('(pointer: fine)');
    const move = (event) => {
      if (!fine.matches) return;
      const rect = panel.getBoundingClientRect();
      table.setPointer(((event.clientX - rect.left) / rect.width) * 2 - 1, ((event.clientY - rect.top) / rect.height) * 2 - 1);
    };
    const leave = () => table.setPointer(0, 0);
    panel.addEventListener('pointermove', move);
    panel.addEventListener('pointerleave', leave);

    return () => {
      resized.disconnect();
      unsubscribe();
      unTheme();
      motion.removeEventListener('change', motionChanged);
      compact.removeEventListener('change', layout);
      panel.removeEventListener('pointermove', move);
      panel.removeEventListener('pointerleave', leave);
      table.destroy();
    };
  }, [stage]);

  const words = describeTable(state);
  const markState = state.phase === 'success' ? 'register' : state.phase === 'busy' ? 'sending' : 'held';

  return (
    <aside ref={tableRef} className="ss-auth-table" aria-labelledby="ss-auth-table-title" data-phase={state.phase}>
      <div className="ss-auth-glass">
        {still ? <TableStill pose={restingPose(state)} /> : <canvas ref={canvasRef} className="ss-auth-canvas" aria-hidden="true" />}
      </div>
      <div ref={copyRef} className="ss-auth-table-copy">
        <h2 id="ss-auth-table-title" className="ss-auth-display">
          Write anywhere. Every copy catches up.
        </h2>
        <p className="ss-auth-table-lede">
          Each device keeps a full copy of your documents. Edits made offline wait on the device and merge when it reconnects:
          combined, never replaced.
        </p>
        <p className="ss-auth-legend">
          <span className="ss-auth-key ss-auth-key--mine">This device</span>
          <span className="ss-auth-key ss-auth-key--server">Server</span>
          <span className="ss-auth-state">
            <RegistrationMark state={markState} size={18} />
            {words}
          </span>
        </p>
      </div>
    </aside>
  );
}
