// What the light table shows for each part of the story. Pure data: the scene animates towards
// these targets, the CSS poster uses the same targets, and the unit tests read them directly.
//
// The model is SyncSpace's own: every sheet is one copy of the same document. A copy's rows are
// the paragraphs it has; copies that agree print the same rows in the same places, so their
// halftone screens coincide. A copy holding edits the others lack is lifted and turned out of
// register, and its unsent rows carry wet ink until the server has stored them.

export const MAX_ROWS = 20;
export const SHEET_IDS = ['key', 'you', 'ana', 'ben'];
export const VERSION_IDS = ['v1', 'v2', 'v3'];

/** Seconds between a reconnect and the moments the droplets land (see Droplets). */
export const TIMING = { toServer: 1.0, toCopies: 1.8, fromServer: 1.4 };

// Every row that appears anywhere in the narrative, in document order. `gap` is paragraph spacing
// before the row; `heading` marks the title.
export const ROWS = [
  { id: 'h0', length: 0.58, heading: 1, gap: 0 },
  { id: 'r1', length: 0.97, gap: 1.3 },
  { id: 'r2', length: 0.92 },
  { id: 'r3', length: 0.99 },
  { id: 'r4', length: 0.48 },
  { id: 'r5', length: 0.95, gap: 1 },
  { id: 'r6', length: 0.88 },
  { id: 'r7', length: 0.36 },
  { id: 'y1', length: 0.93, gap: 1 }, // your paragraph, written offline
  { id: 'y2', length: 0.97 },
  { id: 'y3', length: 0.52 },
  { id: 'r8', length: 0.96, gap: 1 },
  { id: 'r9', length: 0.91 },
  { id: 'r10', length: 0.98 },
  { id: 'r11', length: 0.67 },
  { id: 't1', length: 0.84, gap: 1 }, // Ana typing, live
  { id: 't2', length: 0.58 }, // Ben typing, live
  { id: 'a1', length: 0.94, gap: 1 }, // Ana's paragraph, written while you were offline
  { id: 'a2', length: 0.41 },
  { id: 'spare', length: 0 },
];

const BASE = ['h0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11'];
const LIVE = ['t1', 't2'];
const YOURS = ['y1', 'y2', 'y3'];
const ANAS = ['a1', 'a2'];

export const CHAPTERS = ['hero', 'together', 'offline', 'stored', 'history', 'try'];

const IN_REGISTER = { x: 0, z: 0, turn: 0, lift: 0 };

/** Characters per row when a demo replica's text is laid out on a sheet. */
export const DEMO_ROW_CHARS = 34;

function row(id, overrides = {}) {
  const spec = ROWS.find((candidate) => candidate.id === id);
  return { present: 1, length: spec.length, wet: 0, typed: false, gap: spec.gap ?? 0, heading: spec.heading ?? 0, delay: 0, ...overrides };
}

/** Rows a sheet has: everything in `ids` present, everything else absent but in its place. */
function rowsOf(ids, overrides = {}) {
  const present = new Set(ids);
  return ROWS.map((spec) => (present.has(spec.id) ? row(spec.id, overrides[spec.id]) : row(spec.id, { present: 0, ...overrides[spec.id] })));
}

function sheet(rows, transform = IN_REGISTER, extra = {}) {
  return { visible: 1, transform, rows, ...extra };
}

function hidden(rows) {
  return { visible: 0, transform: IN_REGISTER, rows };
}

/** How a copy that holds edits the others lack sits on the table: lifted and turned. */
export function divergedTransform(unsent, direction = 1) {
  if (unsent <= 0) return { x: 0.012 * direction, z: -0.01, turn: 0, lift: 0.05 };
  const turn = Math.min(1.6 + unsent * 0.35, 6) * direction;
  return { x: 0.03 * direction, z: -0.022, turn, lift: Math.min(0.08 + unsent * 0.01, 0.16) };
}

/** Splits text into the row lengths it would occupy on a sheet (at most MAX_ROWS rows). */
export function textRows(text) {
  const rows = [];
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  for (let start = 0; start < clean.length && rows.length < MAX_ROWS; start += DEMO_ROW_CHARS) {
    rows.push(clean.slice(start, start + DEMO_ROW_CHARS));
  }
  return rows;
}

/** Rows for one demo replica, marking wet the rows whose text the server's copy does not have. */
function demoRows(replica, serverRows, { compare }) {
  const rows = textRows(replica.text);
  return Array.from({ length: MAX_ROWS }, (_, index) => {
    const content = rows[index];
    if (content === undefined) return { present: 0, length: 0.3, wet: 0, typed: false, gap: 0, heading: 0, delay: 0 };
    const wet = compare && serverRows[index] !== content ? 1 : 0;
    return { present: 1, length: Math.max(0.12, content.length / DEMO_ROW_CHARS), wet, typed: false, gap: 0, heading: 0, delay: 0 };
  });
}

function demoTargets(demo) {
  const serverRows = textRows(demo.server.text);
  const device = (replica, direction) => {
    const diverged = !replica.online;
    return sheet(demoRows(replica, serverRows, { compare: diverged }), diverged ? divergedTransform(replica.unsent, direction) : IN_REGISTER);
  };
  const narrativeRows = rowsOf(BASE);
  return {
    camera: 'try',
    sheets: {
      key: sheet(demoRows(demo.server, serverRows, { compare: false })),
      you: device(demo.laptop, 1),
      ana: device(demo.phone, -1),
      ben: hidden(narrativeRows),
    },
    versions: 0,
    carets: [],
  };
}

/**
 * Targets for a stage state.
 * @param {import('./stage-store.js').StageState} state
 */
export function chapterTargets(state) {
  const chapter = CHAPTERS.includes(state.chapter) ? state.chapter : 'hero';

  if (chapter === 'try' && state.demo) return demoTargets(state.demo);

  if (chapter === 'hero' || (chapter === 'try' && !state.demo)) {
    const rows = rowsOf(BASE);
    return {
      camera: 'hero',
      sheets: {
        key: sheet(rows),
        you: sheet(rows, state.pulled ? { x: 0.045, z: 0.03, turn: -4.5, lift: 0.14 } : IN_REGISTER),
        ana: sheet(rows),
        ben: sheet(rows),
      },
      versions: 0,
      carets: [],
    };
  }

  if (chapter === 'together') {
    // Ana and Ben type at the same time; every copy prints both lines as they are typed.
    const typing = { t1: { typed: true, delay: 0.3 }, t2: { typed: true, delay: 0.9 } };
    const rows = rowsOf([...BASE, ...LIVE], typing);
    return {
      camera: 'hero',
      sheets: { key: sheet(rows), you: sheet(rows), ana: sheet(rows), ben: sheet(rows) },
      versions: 0,
      carets: [
        { person: 'ana', row: 't1' },
        { person: 'ben', row: 't2' },
      ],
    };
  }

  if (chapter === 'offline') {
    // You lose the connection and write a paragraph; Ana, still online, adds one of her own.
    const yours = rowsOf([...BASE, ...LIVE, ...YOURS], { y1: { wet: 1 }, y2: { wet: 1, delay: 0.25 }, y3: { wet: 1, delay: 0.5 } });
    const theirs = rowsOf([...BASE, ...LIVE, ...ANAS], { a1: { delay: 0.6 }, a2: { delay: 0.85 } });
    return {
      camera: 'offline',
      sheets: { key: sheet(theirs), you: sheet(yours, divergedTransform(3)), ana: sheet(theirs), ben: sheet(theirs) },
      versions: 0,
      carets: [],
    };
  }

  const everything = [...BASE, ...LIVE, ...YOURS, ...ANAS];

  if (chapter === 'stored') {
    // Reconnected: your paragraph reaches the server first (and only then dries on your sheet),
    // then the other copies; Ana's paragraph comes back to you from the server.
    const arriving = (delay) => Object.fromEntries(YOURS.map((id, index) => [id, { delay: delay + index * 0.12 }]));
    return {
      camera: 'stored',
      sheets: {
        key: sheet(rowsOf(everything, arriving(TIMING.toServer))),
        you: sheet(
          rowsOf(everything, {
            ...Object.fromEntries(YOURS.map((id, index) => [id, { wet: 0, delay: TIMING.toServer + index * 0.12 }])),
            a1: { delay: TIMING.fromServer },
            a2: { delay: TIMING.fromServer + 0.12 },
          }),
        ),
        ana: sheet(rowsOf(everything, arriving(TIMING.toCopies))),
        ben: sheet(rowsOf(everything, arriving(TIMING.toCopies))),
      },
      versions: 0,
      carets: [],
      flow: { from: 'you', rows: YOURS, to: ['ana', 'ben'] },
    };
  }

  // history: the server's earlier versions float above the table, each a proof of the document
  // as it stood then.
  const rows = rowsOf(everything);
  const aside = { x: 0.22, z: 0.02, turn: 0, lift: 0 };
  return {
    camera: 'history',
    sheets: { key: sheet(rows, aside), you: sheet(rows, aside), ana: sheet(rows, aside), ben: sheet(rows, aside) },
    versions: 3,
    versionRows: [rowsOf(BASE), rowsOf([...BASE, ...LIVE]), rowsOf([...BASE, ...LIVE, ...ANAS])],
    carets: [],
  };
}

const SLOT = Object.fromEntries(ROWS.map((spec, index) => [spec.id, index]));

/**
 * The ink that travels when a copy reconnects, if this state change is a reconnect.
 * Returns which sheet sends, which receive, the rows (by slot, laid out on `layoutFrom`'s targets)
 * the droplets carry, and which sheets must wait for the droplets before printing (`holds`, in
 * seconds from now). The narrative's reconnect has its delays built into its targets already.
 */
export function reconnectFlow(previous, next) {
  if (next.chapter === 'stored' && previous.chapter !== 'stored') {
    return {
      source: 'you',
      copies: ['ana', 'ben'],
      rows: YOURS.map((id) => SLOT[id]),
      returnRows: ANAS.map((id) => SLOT[id]),
      layoutFrom: chapterTargets(next).sheets.key.rows,
      holds: {},
    };
  }
  if (next.chapter !== 'try' || previous.chapter !== 'try' || !previous.demo || !next.demo) return null;
  for (const [device, sheetId, otherId] of [
    ['laptop', 'you', 'ana'],
    ['phone', 'ana', 'you'],
  ]) {
    const before = previous.demo[device];
    const after = next.demo[device];
    if (before.online || !after.online || before.unsent === 0) continue;
    const sourceRows = chapterTargets(previous).sheets[sheetId].rows;
    const rows = sourceRows.flatMap((row, index) => (row.present && row.wet ? [index] : []));
    if (rows.length === 0) continue;
    return {
      source: sheetId,
      copies: [otherId, otherId],
      rows,
      returnRows: [],
      layoutFrom: sourceRows,
      holds: { [sheetId]: TIMING.toServer, key: TIMING.toServer, [otherId]: TIMING.toCopies },
    };
  }
  return null;
}
