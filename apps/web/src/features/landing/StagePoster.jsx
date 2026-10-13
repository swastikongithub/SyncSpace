// The light table drawn in SVG: shown at once while the 3D scene loads, and kept as the stage
// whenever WebGPU and WebGL are unavailable, fail, or are turned off. It follows the same
// choreography (without animation), and its dot screens produce real moiré when a copy is
// turned, because SVG patterns rotate with their sheet.
import { useSyncExternalStore } from 'react';
import { CONTENT, LINE } from './animator.js';
import { chapterTargets, ROWS } from './choreography.js';
import { SHEET_SPECS } from './sheet-specs.js';

const SCALE = 300; // SVG units per scene unit
const ORDER = ['key', 'ben', 'ana', 'you'];

/** Rows laid out from targets (the poster shows end states, so no animation state is needed). */
function rowsFromTargets(rows) {
  let cursor = CONTENT.top;
  return rows.map((row) => {
    const height = row.heading ? LINE.headingHeight : LINE.height;
    const pitch = row.heading ? LINE.headingPitch : LINE.pitch;
    cursor -= row.gap * LINE.gap * row.present;
    const y = cursor - height / 2;
    cursor -= pitch * row.present;
    return { y, height, length: row.length * CONTENT.width, present: row.present, wet: row.wet };
  });
}

function Sheet({ id, target }) {
  const spec = SHEET_SPECS[id];
  const [cx, cy, hw, hh] = spec.paperRect;
  const { x, z, turn } = target.transform;
  const rows = rowsFromTargets(target.rows);
  return (
    <g className="ss-poster-sheet" style={{ transform: `translate(${x * SCALE}px, ${z * SCALE}px) rotate(${turn}deg)`, opacity: target.visible }}>
      <rect
        x={(cx - hw) * SCALE}
        y={-(cy + hh) * SCALE}
        width={hw * 2 * SCALE}
        height={hh * 2 * SCALE}
        rx={0.012 * SCALE}
        fill={spec.tint > 0 ? `url(#poster-tint-${id})` : spec.paper}
        stroke="rgb(0 0 0 / 0.16)"
        strokeWidth="0.8"
      />
      {rows.map((row, index) =>
        row.present > 0 ? (
          <rect
            key={ROWS[index]?.id ?? index}
            x={CONTENT.left * SCALE}
            y={-(row.y + row.height / 2) * SCALE}
            width={row.length * SCALE}
            height={row.height * SCALE}
            fill={`url(#poster-ink-${row.wet ? 'wet' : id})`}
          />
        ) : null,
      )}
      {[
        [0, 0.668],
        [0, -0.69],
        [-0.468, -0.01],
        [0.468, -0.01],
      ].map(([tx, ty]) => (
        <g key={`${tx},${ty}`} transform={`translate(${tx * SCALE} ${-ty * SCALE})`} stroke={spec.ink} strokeWidth="1" fill="none">
          <circle r={0.016 * SCALE} />
          <path d={`M${-0.03 * SCALE} 0H${0.03 * SCALE}M0 ${-0.03 * SCALE}V${0.03 * SCALE}`} />
        </g>
      ))}
    </g>
  );
}

const PITCH = 0.0125 * SCALE;

function Patterns() {
  const dots = (id, colour, radius, background) => (
    <pattern key={id} id={id} width={PITCH} height={PITCH} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      {background && <rect width={PITCH} height={PITCH} fill={background} />}
      <circle cx={PITCH / 2} cy={PITCH / 2} r={radius * PITCH} fill={colour} />
    </pattern>
  );
  return (
    <defs>
      {Object.entries(SHEET_SPECS)
        .filter(([, spec]) => spec.tint > 0)
        .map(([id, spec]) => dots(`poster-tint-${id}`, spec.screen, Math.sqrt(spec.tint / Math.PI), spec.paper))}
      {Object.entries(SHEET_SPECS).map(([id, spec]) => dots(`poster-ink-${id}`, spec.ink, 0.47))}
      {dots('poster-ink-wet', SHEET_SPECS.you.wet, 0.56)}
    </defs>
  );
}

export function StagePoster({ store }) {
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  const targets = chapterTargets(state);
  return (
    <div className="ss-poster" aria-hidden="true">
      <svg viewBox="-330 -360 660 720" className="ss-poster-table">
        <Patterns />
        {/* The pad: 1.78 x 2.08 scene units, like the 3D one. */}
        <rect x="-267" y="-312" width="534" height="624" rx="14" className="ss-poster-glass" />
        <g className="ss-poster-sheets">
          {ORDER.map((id) => (
            <Sheet key={id} id={id} target={targets.sheets[id]} />
          ))}
        </g>
      </svg>
    </div>
  );
}
