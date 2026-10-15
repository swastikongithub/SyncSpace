// The sign-in pages' light table: two copies of one page, this device's (violet ink on paper)
// and the server's (grey ink on clear film). Signed out, this device's copy lies out of register
// and the two dot screens beat as moiré. Filling in the form draws it partway in; signing in
// snaps it into register and its wet ink dries. Creating an account prints the copy as you go.
// State, poses, springs and layout live here (pure, tested); drawing is in registration-gl.js.

/** How far out of register this device's copy rests, at a sheet half-width of 180 px. */
export const OUT = Object.freeze({ x: 26, y: -18, angle: -0.062 });
/** Where it starts on first paint, so it arrives rather than appears. */
export const ENTRANCE = Object.freeze({ x: 150, y: -96, angle: -0.2 });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const looksLikeEmail = (value) => EMAIL.test(value.trim());

const clamp01 = (value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

/** How complete the sign-in form looks, 0 to 1. Only a hint for the illustration. */
export function signInProgress({ email, password }) {
  const emailPart = looksLikeEmail(email) ? 0.5 : email.trim() ? 0.2 : 0;
  return emailPart + 0.5 * clamp01(password.length / 8);
}

/** How complete the registration form looks, 0 to 1. */
export function registerProgress({ name, email, password }, passwordMin) {
  const namePart = name.trim() ? 1 : 0;
  const emailPart = looksLikeEmail(email) ? 1 : email.trim() ? 0.4 : 0;
  return (namePart + emailPart + clamp01(password.length / passwordMin)) / 3;
}

/**
 * The pose this device's copy settles into.
 * @param {{ mode: 'signin' | 'register', phase: 'idle' | 'busy' | 'success' | 'error', progress: number }} state
 * @returns {{ x: number, y: number, angle: number, wet: number, printed: number, lift: number }}
 *   x, y in px at the reference sheet size; angle in radians; wet 1 = wet ink, 0 = dry;
 *   printed = the share of the page's lines printed; lift = how far it is raised off the film.
 */
export function restingPose({ mode, phase, progress }) {
  if (phase === 'success') return { x: 0, y: 0, angle: 0, wet: 0, printed: 1, lift: 0 };
  const p = clamp01(progress);
  const away = 1 - (phase === 'busy' ? 0.78 : 0.5 * p);
  return {
    x: OUT.x * away,
    y: OUT.y * away,
    angle: OUT.angle * away,
    wet: 1,
    printed: mode === 'register' ? (phase === 'busy' ? 1 : 0.1 + 0.9 * p) : 1,
    lift: away,
  };
}

/** Words for the table's state, shown beside the registration mark. */
export function describeTable({ mode, phase }) {
  if (phase === 'busy') return mode === 'register' ? 'Creating your account…' : 'Signing in…';
  if (phase === 'success') return 'In step with the server';
  return mode === 'register' ? 'No account on this device yet' : 'Not signed in on this device';
}

/**
 * Where the server's film lies on a table of the given size (CSS px). This device's copy is the
 * same size and lies on top of it, offset by its pose.
 * @returns {{ cx: number, cy: number, hw: number, hh: number, scale: number }}
 */
export function sheetLayout({ width, height, reserveBottom = 0, compact = false }) {
  const aspect = 1.32;
  if (compact) {
    // A short band on phones: a close crop of the sheets, cut off by the band's lower edge.
    const hw = Math.max(60, Math.min(width * 0.34, 168));
    const hh = hw * aspect;
    return { cx: width * 0.5, cy: 26 + hh, hw, hh, scale: hw / 180 };
  }
  const top = 36;
  const available = Math.max(120, height - reserveBottom - top - 28);
  const hh = Math.max(60, Math.min(available * 0.5, width * 0.33 * aspect, 320));
  const hw = hh / aspect;
  return { cx: width * 0.54, cy: top + available * 0.5, hw, hh, scale: hw / 180 };
}

/** A small store shared by the auth layout (which draws) and the form pages (which act). */
export function createAuthStage(initial = {}) {
  let state = { mode: 'signin', phase: 'idle', progress: 0, jolts: 0, ...initial };
  const listeners = new Set();
  return {
    get: () => state,
    set(partial) {
      const next = { ...state, ...partial };
      if (Object.keys(next).every((key) => next[key] === state[key])) return;
      state = next;
      listeners.forEach((listener) => listener());
    },
    /** A failed attempt: the copy jumps back out of register. */
    jolt() {
      state = { ...state, phase: 'error', jolts: state.jolts + 1 };
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/* ---- Springs ----------------------------------------------------------------------------
   Slightly under-damped, stepped in small fixed substeps so motion keeps real time and stays
   stable whatever the frame rate. */

export const SPRING = Object.freeze({ stiffness: 140, damping: 19 });

export function createSpring(value) {
  return { value, velocity: 0, target: value };
}

/** Advances a spring by `dt` seconds. */
export function stepSpring(spring, dt, { stiffness, damping } = SPRING) {
  let remaining = Math.min(dt, 0.25);
  while (remaining > 1e-6) {
    const h = Math.min(remaining, 1 / 240);
    const force = stiffness * (spring.target - spring.value) - damping * spring.velocity;
    spring.velocity += force * h;
    spring.value += spring.velocity * h;
    remaining -= h;
  }
  return spring;
}

export function springSettled(spring, epsilon = 1e-3) {
  return Math.abs(spring.target - spring.value) < epsilon && Math.abs(spring.velocity) < epsilon * 10;
}
