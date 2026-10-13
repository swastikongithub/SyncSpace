// Moves the light table's copies towards their chapter targets. Plain numbers, no three.js: the
// scene copies the results into uniforms and transforms each frame, and the tests drive it
// directly. Values change only through critically damped springs (no overshoot, stable at any
// frame time), except typing progress, which advances at a steady speed like a person typing.
import { MAX_ROWS, SHEET_IDS, VERSION_IDS } from './choreography.js';

// Content frame of a sheet, in scene units (a sheet's paper is about 1 x 1.41).
export const CONTENT = { left: -0.42, top: 0.6, width: 0.84 };
export const LINE = { pitch: 0.05, height: 0.026, headingPitch: 0.074, headingHeight: 0.046, gap: 0.03 };

const TYPING_SPEED = 0.55; // of a row per second
const EPSILON = 0.0005;

const ROW_FIELDS = ['present', 'length', 'wet', 'gap', 'heading'];
const TRANSFORM_FIELDS = ['x', 'z', 'turn', 'lift'];

const STIFFNESS = { present: 7, length: 9, wet: 3.2, gap: 7, heading: 7, x: 6, z: 6, turn: 6, lift: 6, visible: 5, caret: 8 };

export function channel(value, stiffness) {
  return { value, velocity: 0, target: value, pending: null, stiffness };
}

export function retarget(state, target, now, delay = 0) {
  const last = state.pending ? state.pending.target : state.target;
  if (Object.is(last, target)) return;
  if (delay > 0) state.pending = { target, at: now + delay };
  else {
    state.pending = null;
    state.target = target;
  }
}

export function settleNow(state) {
  if (state.pending) state.target = state.pending.target;
  state.pending = null;
  state.value = state.target;
  state.velocity = 0;
}

/** Implicit critically damped spring step. Returns true while still moving. */
export function springStep(state, dt, now) {
  if (state.pending && now >= state.pending.at) {
    state.target = state.pending.target;
    state.pending = null;
  }
  const omega = state.stiffness;
  const f = 1 + 2 * dt * omega;
  const hoo = dt * omega * omega;
  const hhoo = dt * hoo;
  const inverse = 1 / (f + hhoo);
  const x = (f * state.value + dt * state.velocity + hhoo * state.target) * inverse;
  const v = (state.velocity + hoo * (state.target - state.value)) * inverse;
  const settled = Math.abs(state.target - x) <= EPSILON && Math.abs(v) <= EPSILON;
  state.value = settled ? state.target : x;
  state.velocity = settled ? 0 : v;
  return state.pending !== null || !settled;
}

/** Typing: forwards at a steady speed, backwards (scrolling back up) at once. */
function typeStep(state, dt, now) {
  if (state.pending && now >= state.pending.at) {
    state.target = state.pending.target;
    state.pending = null;
  }
  if (state.value < state.target) state.value = Math.min(state.target, state.value + dt * TYPING_SPEED);
  else state.value = state.target;
  return state.pending !== null || state.value !== state.target;
}

function createSheet() {
  return {
    visible: channel(1, STIFFNESS.visible),
    transform: Object.fromEntries(TRANSFORM_FIELDS.map((field) => [field, channel(0, STIFFNESS[field])])),
    rows: Array.from({ length: MAX_ROWS }, () => ({
      ...Object.fromEntries(ROW_FIELDS.map((field) => [field, channel(0, STIFFNESS[field])])),
      progress: channel(1, 0),
    })),
  };
}

export function createAnimator() {
  const sheets = Object.fromEntries([...SHEET_IDS, ...VERSION_IDS].map((id) => [id, createSheet()]));
  const carets = [channel(0, STIFFNESS.caret), channel(0, STIFFNESS.caret)];
  let caretRows = [null, null];
  let started = false;
  const holds = {}; // sheet id -> time before which arrivals and drying wait (droplets in flight)

  function applySheet(sheet, target, now, id) {
    const held = Math.max(0, (holds[id] ?? 0) - now);
    retarget(sheet.visible, target.visible, now);
    for (const field of TRANSFORM_FIELDS) retarget(sheet.transform[field], target.transform[field], now);
    target.rows.forEach((row, index) => {
      const state = sheet.rows[index];
      const arriving = row.present > 0 && state.present.target === 0 && state.present.pending === null;
      for (const field of ROW_FIELDS) {
        // Rows leave immediately; arrivals and drying wait for their moment.
        const delayed = field === 'present' ? row.present > state.present.target : field === 'wet' ? row.wet < state.wet.target : false;
        retarget(state[field], row[field], now, delayed ? Math.max(row.delay, held) : 0);
      }
      // A typed row grows from its first character once it arrives; every other row is whole.
      if (arriving && row.typed) {
        state.progress.value = 0;
        retarget(state.progress, 1, now, row.delay);
      } else if (!row.typed) {
        settleNow(state.progress);
        state.progress.target = 1;
        state.progress.value = 1;
      }
    });
  }

  return {
    sheets,
    carets,
    get caretRows() {
      return caretRows;
    },

    /**
     * @param {ReturnType<import('./choreography.js').chapterTargets>} targets
     * @param {number} now seconds
     * @param {{ instant?: boolean }} options instant: jump to the end state (reduced motion, first frame)
     */
    setTargets(targets, now, { instant = false } = {}) {
      for (const id of SHEET_IDS) applySheet(sheets[id], targets.sheets[id], now, id);
      VERSION_IDS.forEach((id, index) => {
        const rows = targets.versionRows?.[index];
        const visible = index < (targets.versions ?? 0) ? 1 : 0;
        applySheet(sheets[id], { visible, transform: { x: 0, z: 0, turn: 0, lift: 0 }, rows: rows ?? targets.sheets.key.rows }, now, id);
      });
      caretRows = [targets.carets?.[0]?.row ?? caretRows[0], targets.carets?.[1]?.row ?? caretRows[1]];
      carets.forEach((caret, index) => retarget(caret, targets.carets?.[index] ? 1 : 0, now));
      if (instant || !started) this.finish();
      started = true;
    },

    /** Makes arrivals and drying on these sheets wait (seconds from `now`) for droplets in flight. */
    hold(waits, now) {
      for (const [id, seconds] of Object.entries(waits)) holds[id] = now + seconds;
    },

    /** Jumps every value to its final target. */
    finish() {
      for (const sheet of Object.values(sheets)) {
        settleNow(sheet.visible);
        for (const field of TRANSFORM_FIELDS) settleNow(sheet.transform[field]);
        for (const row of sheet.rows) {
          for (const field of ROW_FIELDS) settleNow(row[field]);
          settleNow(row.progress);
        }
      }
      carets.forEach(settleNow);
    },

    /** Advances the animation. Returns true while anything is still moving. */
    step(dt, now) {
      let moving = false;
      for (const sheet of Object.values(sheets)) {
        moving = springStep(sheet.visible, dt, now) || moving;
        for (const field of TRANSFORM_FIELDS) moving = springStep(sheet.transform[field], dt, now) || moving;
        for (const row of sheet.rows) {
          for (const field of ROW_FIELDS) moving = springStep(row[field], dt, now) || moving;
          moving = typeStep(row.progress, dt, now) || moving;
        }
      }
      for (const caret of carets) moving = springStep(caret, dt, now) || moving;
      return moving;
    },
  };
}

/** Lays out rows from target values (end states): for the poster and for aiming droplets. */
export function layoutTargets(rows) {
  return layoutRows({
    rows: rows.map((row) => ({
      present: { value: row.present },
      heading: { value: row.heading },
      gap: { value: row.gap },
      length: { value: row.length },
      progress: { value: 1 },
      wet: { value: row.wet },
    })),
  });
}

/**
 * Lays out one sheet's rows from their current values: each row's vertical centre, half height,
 * printed length (scene units) and ink density. Rows that are absent take no space, so a row
 * arriving pushes the rows after it down as it prints in.
 * @returns {{ y: number, halfHeight: number, length: number, density: number, wet: number }[]}
 */
export function layoutRows(sheet) {
  let cursor = CONTENT.top;
  return sheet.rows.map((row) => {
    const present = Math.max(0, Math.min(1, row.present.value));
    const heading = row.heading.value;
    const height = LINE.height + (LINE.headingHeight - LINE.height) * heading;
    const pitch = LINE.pitch + (LINE.headingPitch - LINE.pitch) * heading;
    cursor -= row.gap.value * LINE.gap * present;
    const y = cursor - height / 2;
    cursor -= pitch * present;
    return {
      y,
      halfHeight: height / 2,
      length: Math.max(0, row.length.value) * Math.max(0, Math.min(1, row.progress.value)) * CONTENT.width,
      density: present,
      wet: Math.max(0, Math.min(1, row.wet.value)),
    };
  });
}
