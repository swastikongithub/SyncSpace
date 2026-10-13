import { describe, expect, it } from 'vitest';
import { CONTENT, LINE, createAnimator, layoutRows, layoutTargets } from './animator.js';
import { CHAPTERS, MAX_ROWS, ROWS, TIMING, chapterTargets, divergedTransform, reconnectFlow, textRows } from './choreography.js';
import { createStageStore } from './stage-store.js';

const slot = (id) => ROWS.findIndex((row) => row.id === id);
const present = (sheet) => sheet.rows.flatMap((row, index) => (row.present ? [ROWS[index].id] : []));
const IN_REGISTER = { x: 0, z: 0, turn: 0, lift: 0 };

function demo({ laptop = {}, phone = {} } = {}) {
  const base = 'Lab meeting moved to Thursday. Bring the results.';
  return {
    laptop: { text: base, online: true, unsent: 0, ...laptop },
    server: { text: base, online: true, unsent: 0 },
    phone: { text: base, online: true, unsent: 0, ...phone },
  };
}

describe('chapter targets', () => {
  it('starts with every copy in register, printing the same rows', () => {
    const targets = chapterTargets({ chapter: 'hero', pulled: false, demo: null });
    for (const sheet of Object.values(targets.sheets)) {
      expect(sheet.transform).toEqual(IN_REGISTER);
      expect(present(sheet)).toEqual(present(targets.sheets.key));
    }
  });

  it('pulls only your copy out of register when asked', () => {
    const targets = chapterTargets({ chapter: 'hero', pulled: true, demo: null });
    expect(targets.sheets.you.transform.lift).toBeGreaterThan(0);
    expect(targets.sheets.you.transform.turn).not.toBe(0);
    expect(targets.sheets.ana.transform).toEqual(IN_REGISTER);
  });

  it('types Ana’s and Ben’s lines into every copy at once while together', () => {
    const targets = chapterTargets({ chapter: 'together' });
    for (const sheet of Object.values(targets.sheets)) {
      expect(sheet.rows[slot('t1')]).toMatchObject({ present: 1, typed: true });
      expect(sheet.rows[slot('t2')]).toMatchObject({ present: 1, typed: true });
    }
    expect(targets.carets.map((caret) => caret.person)).toEqual(['ana', 'ben']);
  });

  it('offline: your copy diverges with wet rows; the others have Ana’s paragraph and not yours', () => {
    const targets = chapterTargets({ chapter: 'offline' });
    const you = targets.sheets.you;
    expect(you.transform.lift).toBeGreaterThan(0);
    expect(Math.abs(you.transform.turn)).toBeGreaterThan(1);
    for (const id of ['y1', 'y2', 'y3']) expect(you.rows[slot(id)]).toMatchObject({ present: 1, wet: 1 });
    for (const id of ['a1', 'a2']) expect(you.rows[slot(id)].present).toBe(0);
    for (const other of ['key', 'ana', 'ben']) {
      expect(targets.sheets[other].transform).toEqual(IN_REGISTER);
      for (const id of ['y1', 'y2', 'y3']) expect(targets.sheets[other].rows[slot(id)].present).toBe(0);
      for (const id of ['a1', 'a2']) expect(targets.sheets[other].rows[slot(id)].present).toBe(1);
    }
  });

  it('stored: every copy ends identical, and your ink dries only when the server has it', () => {
    const targets = chapterTargets({ chapter: 'stored' });
    const rows = present(targets.sheets.key);
    for (const sheet of Object.values(targets.sheets)) {
      expect(sheet.transform).toEqual(IN_REGISTER);
      expect(present(sheet)).toEqual(rows);
      expect(sheet.rows.every((row) => row.wet === 0)).toBe(true);
    }
    // Arrival order: the server first, then the other copies; drying waits for the server.
    expect(targets.sheets.key.rows[slot('y1')].delay).toBe(TIMING.toServer);
    expect(targets.sheets.ana.rows[slot('y1')].delay).toBe(TIMING.toCopies);
    expect(targets.sheets.you.rows[slot('y1')].delay).toBe(TIMING.toServer);
    expect(TIMING.toServer).toBeLessThan(TIMING.toCopies);
  });

  it('history shows three earlier versions, each a prefix of the story', () => {
    const targets = chapterTargets({ chapter: 'history' });
    expect(targets.versions).toBe(3);
    const counts = targets.versionRows.map((rows) => rows.filter((row) => row.present).length);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
  });

  it('falls back to the opening state for unknown chapters, and to it for the demo before it reports', () => {
    expect(chapterTargets({ chapter: 'nonsense' }).camera).toBe('hero');
    expect(chapterTargets({ chapter: 'try', demo: null }).camera).toBe('hero');
  });

  it('covers every chapter the page uses', () => {
    for (const chapter of CHAPTERS) expect(() => chapterTargets({ chapter, demo: demo() })).not.toThrow();
  });
});

describe('the demo on the table', () => {
  it('lays text out in rows of at most MAX_ROWS', () => {
    expect(textRows('')).toEqual([]);
    expect(textRows('x'.repeat(10_000))).toHaveLength(MAX_ROWS);
    expect(textRows('a  b\n c')).toEqual(['a b c']);
  });

  it('keeps online copies in register and dry', () => {
    const targets = chapterTargets({ chapter: 'try', demo: demo() });
    expect(targets.sheets.you.transform).toEqual(IN_REGISTER);
    expect(targets.sheets.you.rows.every((row) => row.wet === 0)).toBe(true);
    expect(targets.sheets.ben.visible).toBe(0);
  });

  it('lifts an offline copy and wets exactly the rows the server does not have', () => {
    const text = 'Lab meeting moved to Thursday. Bring the results. And the spare thermometer, please.';
    const targets = chapterTargets({ chapter: 'try', demo: demo({ laptop: { text, online: false, unsent: 12 } }) });
    const you = targets.sheets.you;
    expect(you.transform.lift).toBeGreaterThan(0);
    const wet = you.rows.map((row) => row.wet);
    expect(wet[0]).toBe(0); // the first row is unchanged
    expect(wet.slice(1, textRows(text).length).every((value) => value === 1)).toBe(true);
    expect(targets.sheets.key.rows.every((row) => row.wet === 0)).toBe(true);
  });

  it('turns a copy further out of register the more it holds, within a limit', () => {
    const turns = [0, 1, 5, 50, 500].map((unsent) => Math.abs(divergedTransform(unsent).turn));
    expect(turns).toEqual([...turns].sort((a, b) => a - b));
    expect(Math.max(...turns)).toBeLessThanOrEqual(6);
    expect(divergedTransform(3, -1).turn).toBe(-divergedTransform(3, 1).turn);
  });
});

describe('reconnect flows', () => {
  it('sends your paragraph when the story reaches "stored", and Ana’s back to you', () => {
    const flow = reconnectFlow({ chapter: 'offline' }, { chapter: 'stored' });
    expect(flow).toMatchObject({ source: 'you', copies: ['ana', 'ben'] });
    expect(flow.rows).toEqual(['y1', 'y2', 'y3'].map(slot));
    expect(flow.returnRows).toEqual(['a1', 'a2'].map(slot));
    expect(reconnectFlow({ chapter: 'stored' }, { chapter: 'stored' })).toBeNull();
  });

  it('starts when a demo device reconnects holding edits, carrying its wet rows', () => {
    const text = 'Lab meeting moved to Thursday. Bring the results. And the spare thermometer.';
    const before = { chapter: 'try', demo: demo({ phone: { text, online: false, unsent: 4 } }) };
    const after = { chapter: 'try', demo: demo({ phone: { text, online: true, unsent: 0 } }) };
    const flow = reconnectFlow(before, after);
    expect(flow).toMatchObject({ source: 'ana', copies: ['you', 'you'] });
    expect(flow.rows.length).toBeGreaterThan(0);
    expect(flow.holds.key).toBe(TIMING.toServer);
    expect(flow.holds.you).toBe(TIMING.toCopies);
  });

  it('does not start for a reconnect with nothing unsent, or outside the demo', () => {
    const before = { chapter: 'try', demo: demo({ laptop: { online: false } }) };
    const after = { chapter: 'try', demo: demo() };
    expect(reconnectFlow(before, after)).toBeNull();
    expect(reconnectFlow({ chapter: 'hero' }, { chapter: 'together' })).toBeNull();
  });
});

describe('animator', () => {
  const run = (animator, from, seconds, step = 1 / 60) => {
    let moving = true;
    let t = from;
    for (; t < from + seconds; t += step) moving = animator.step(step, t);
    return moving;
  };

  it('starts at its first targets, then settles after a change and stops asking for frames', () => {
    const animator = createAnimator();
    animator.setTargets(chapterTargets({ chapter: 'hero' }), 0);
    expect(animator.step(1 / 60, 0)).toBe(false);
    animator.setTargets(chapterTargets({ chapter: 'offline' }), 1);
    expect(animator.step(1 / 60, 1)).toBe(true);
    expect(run(animator, 1, 8)).toBe(false);
    expect(animator.sheets.you.transform.turn.value).toBeCloseTo(chapterTargets({ chapter: 'offline' }).sheets.you.transform.turn, 5);
  });

  it('jumps straight to the end state when motion is reduced', () => {
    const animator = createAnimator();
    animator.setTargets(chapterTargets({ chapter: 'hero' }), 0);
    animator.setTargets(chapterTargets({ chapter: 'stored' }), 1, { instant: true });
    expect(animator.step(1 / 60, 1)).toBe(false);
    expect(animator.sheets.ana.rows[slot('y1')].present.value).toBe(1);
  });

  it('prints an arriving row only after its delay', () => {
    const animator = createAnimator();
    animator.setTargets(chapterTargets({ chapter: 'offline' }), 0);
    animator.setTargets(chapterTargets({ chapter: 'stored' }), 10);
    run(animator, 10, TIMING.toCopies - 0.05);
    expect(animator.sheets.ana.rows[slot('y1')].present.value).toBe(0);
    expect(animator.sheets.key.rows[slot('y1')].present.value).toBeGreaterThan(0.5);
    run(animator, 10 + TIMING.toCopies - 0.05, 3);
    expect(animator.sheets.ana.rows[slot('y1')].present.value).toBe(1);
  });

  it('keeps your ink wet until the server has stored it', () => {
    const animator = createAnimator();
    animator.setTargets(chapterTargets({ chapter: 'offline' }), 0);
    animator.setTargets(chapterTargets({ chapter: 'stored' }), 10);
    run(animator, 10, TIMING.toServer - 0.05);
    expect(animator.sheets.you.rows[slot('y1')].wet.value).toBe(1);
    run(animator, 10 + TIMING.toServer - 0.05, 4);
    expect(animator.sheets.you.rows[slot('y1')].wet.value).toBe(0);
  });

  it('types a live row from its first character at a steady speed', () => {
    const animator = createAnimator();
    animator.setTargets(chapterTargets({ chapter: 'hero' }), 0);
    animator.setTargets(chapterTargets({ chapter: 'together' }), 5);
    const t1 = animator.sheets.key.rows[slot('t1')];
    run(animator, 5, 0.5);
    const early = t1.progress.value;
    run(animator, 5.5, 0.5);
    expect(early).toBeGreaterThan(0);
    expect(t1.progress.value).toBeGreaterThan(early);
    expect(t1.progress.value).toBeLessThan(1);
  });

  it('holds arrivals on a sheet while droplets are in flight', () => {
    const animator = createAnimator();
    const before = demo();
    const text = `${before.server.text} Room 214 is booked for the whole afternoon.`;
    animator.setTargets(chapterTargets({ chapter: 'try', demo: before }), 0);
    animator.hold({ key: 1 }, 10);
    animator.setTargets(chapterTargets({ chapter: 'try', demo: { ...before, server: { ...before.server, text } } }), 10);
    const index = textRows(text).length - 1;
    expect(index).toBe(textRows(before.server.text).length); // a new row
    run(animator, 10, 0.9);
    expect(animator.sheets.key.rows[index].present.value).toBe(0);
    run(animator, 10.9, 2);
    expect(animator.sheets.key.rows[index].present.value).toBe(1);
  });
});

describe('row layout', () => {
  it('stacks present rows from the top and gives absent rows no space', () => {
    const rows = layoutTargets(chapterTargets({ chapter: 'hero' }).sheets.key.rows);
    const heading = rows[slot('h0')];
    expect(heading.y).toBeCloseTo(CONTENT.top - LINE.headingHeight / 2, 6);
    expect(heading.halfHeight * 2).toBeCloseTo(LINE.headingHeight, 6);
    // y1 is absent in the opening chapter: it takes no height, so r8 follows it by just its gap.
    expect(rows[slot('y1')].density).toBe(0);
    expect(rows[slot('r8')].y).toBeCloseTo(rows[slot('y1')].y - LINE.gap, 6);
    expect(rows[slot('r2')].y).toBeLessThan(rows[slot('r1')].y);
  });

  it('pushes later rows down when a paragraph arrives', () => {
    const before = layoutTargets(chapterTargets({ chapter: 'hero' }).sheets.key.rows);
    const after = layoutTargets(chapterTargets({ chapter: 'stored' }).sheets.key.rows);
    expect(after[slot('r8')].y).toBeLessThan(before[slot('r8')].y);
    expect(after[slot('r1')].y).toBeCloseTo(before[slot('r1')].y, 6);
  });

  it('prints a typed row only as far as it has been typed', () => {
    const animator = createAnimator();
    animator.setTargets(chapterTargets({ chapter: 'together' }), 0, { instant: true });
    const sheet = animator.sheets.key;
    sheet.rows[slot('t1')].progress.value = 0.5;
    const rows = layoutRows(sheet);
    expect(rows[slot('t1')].length).toBeCloseTo(ROWS[slot('t1')].length * 0.5 * CONTENT.width, 6);
  });
});

describe('stage store', () => {
  it('notifies only on real changes', () => {
    const store = createStageStore();
    const seen = [];
    store.subscribe((state) => seen.push(state.chapter));
    store.set({ chapter: 'hero' });
    store.set({ chapter: 'offline' });
    store.set({ chapter: 'offline' });
    expect(seen).toEqual(['offline']);
    expect(store.get().chapter).toBe('offline');
  });
});
