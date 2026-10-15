import { describe, expect, it } from 'vitest';
import {
  OUT,
  createAuthStage,
  createSpring,
  describeTable,
  registerProgress,
  restingPose,
  sheetLayout,
  signInProgress,
  springSettled,
  stepSpring,
} from './registration.js';

describe('form progress', () => {
  it('counts a sign-in form as complete once the email looks real and a password is typed', () => {
    expect(signInProgress({ email: '', password: '' })).toBe(0);
    expect(signInProgress({ email: 'ana', password: '' })).toBeCloseTo(0.2);
    expect(signInProgress({ email: 'ana@example.org', password: '' })).toBe(0.5);
    expect(signInProgress({ email: 'ana@example.org', password: 'long enough' })).toBe(1);
  });

  it('weights the three registration fields equally, the password by the minimum length', () => {
    expect(registerProgress({ name: '', email: '', password: '' }, 10)).toBe(0);
    expect(registerProgress({ name: 'Ana', email: '', password: '' }, 10)).toBeCloseTo(1 / 3);
    expect(registerProgress({ name: 'Ana', email: 'ana@example.org', password: '12345' }, 10)).toBeCloseTo(2.5 / 3);
    expect(registerProgress({ name: 'Ana', email: 'ana@example.org', password: '0123456789' }, 10)).toBe(1);
  });
});

describe('resting pose', () => {
  it('rests fully out of register on an empty form, with wet ink', () => {
    const pose = restingPose({ mode: 'signin', phase: 'idle', progress: 0 });
    expect(pose).toMatchObject({ x: OUT.x, y: OUT.y, angle: OUT.angle, wet: 1, printed: 1, lift: 1 });
  });

  it('comes at most halfway in while the form is filled, further while signing in', () => {
    const filled = restingPose({ mode: 'signin', phase: 'idle', progress: 1 });
    const busy = restingPose({ mode: 'signin', phase: 'busy', progress: 1 });
    expect(filled.x).toBeCloseTo(OUT.x / 2);
    expect(Math.abs(busy.x)).toBeLessThan(Math.abs(filled.x));
    expect(busy.x).not.toBe(0);
  });

  it('is in register with dry ink only after success', () => {
    expect(restingPose({ mode: 'register', phase: 'success', progress: 0.3 })).toEqual({ x: 0, y: 0, angle: 0, wet: 0, printed: 1, lift: 0 });
    expect(restingPose({ mode: 'signin', phase: 'error', progress: 1 }).lift).toBeGreaterThan(0);
  });

  it('prints a new account’s copy as the form fills', () => {
    expect(restingPose({ mode: 'register', phase: 'idle', progress: 0 }).printed).toBeCloseTo(0.1);
    expect(restingPose({ mode: 'register', phase: 'idle', progress: 1 }).printed).toBe(1);
    expect(restingPose({ mode: 'signin', phase: 'idle', progress: 0 }).printed).toBe(1);
  });

  it('describes each state in words', () => {
    expect(describeTable({ mode: 'signin', phase: 'idle' })).toBe('Not signed in on this device');
    expect(describeTable({ mode: 'register', phase: 'busy' })).toBe('Creating your account…');
    expect(describeTable({ mode: 'signin', phase: 'success' })).toBe('In step with the server');
  });
});

describe('springs', () => {
  it('settle on the target in about half a second, at any frame rate', () => {
    for (const fps of [144, 60, 24, 8]) {
      const spring = createSpring(0);
      spring.target = 1;
      for (let t = 0; t < 0.9; t += 1 / fps) stepSpring(spring, 1 / fps);
      expect(spring.value, `${fps} fps`).toBeCloseTo(1, 2);
    }
  });

  it('overshoots only slightly', () => {
    const spring = createSpring(0);
    spring.target = 1;
    let peak = 0;
    for (let i = 0; i < 240; i += 1) peak = Math.max(peak, stepSpring(spring, 1 / 120).value);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.08);
    expect(springSettled(spring)).toBe(true);
  });

  it('caps a long frame so a background tab does not fling the sheet', () => {
    const spring = createSpring(0);
    spring.target = 1;
    stepSpring(spring, 30);
    expect(Number.isFinite(spring.value)).toBe(true);
    expect(spring.value).toBeLessThan(1.1);
  });
});

describe('sheet layout', () => {
  it('fits the sheets above the text on a desktop table', () => {
    const layout = sheetLayout({ width: 760, height: 900, reserveBottom: 280 });
    expect(layout.cy + layout.hh).toBeLessThan(900 - 280);
    expect(layout.cy - layout.hh).toBeGreaterThan(0);
    expect(layout.cx + layout.hw).toBeLessThan(760);
  });

  it('crops the sheets in a phone band', () => {
    const layout = sheetLayout({ width: 360, height: 180, compact: true });
    expect(layout.cy + layout.hh).toBeGreaterThan(180);
    expect(layout.cy - layout.hh).toBeGreaterThan(0);
  });
});

describe('stage store', () => {
  it('notifies only on change, and a jolt marks the attempt as failed', () => {
    const stage = createAuthStage();
    let calls = 0;
    stage.subscribe(() => (calls += 1));
    stage.set({ progress: 0 });
    expect(calls).toBe(0);
    stage.set({ progress: 0.5 });
    stage.jolt();
    expect(calls).toBe(2);
    expect(stage.get()).toMatchObject({ phase: 'error', jolts: 1, progress: 0.5 });
  });
});
