// State shared by the landing page's HTML (which writes it) and the light-table scene (which
// reads it every frame). It lives outside React so the scene can follow it without re-rendering.

/**
 * @typedef {object} DemoReplica
 * @property {string} text      the replica's current text
 * @property {boolean} online
 * @property {number} unsent    edits made while offline that the server has not received
 *
 * @typedef {object} StageState
 * @property {string} chapter   which part of the story is in view (see CHAPTERS)
 * @property {boolean} pulled   the visitor pulled their copy out of register (hero control)
 * @property {{ laptop: DemoReplica, server: DemoReplica, phone: DemoReplica } | null} demo
 */

export function createStageStore(initial = {}) {
  /** @type {StageState} */
  let state = { chapter: 'hero', pulled: false, demo: null, ...initial };
  const listeners = new Set();
  return {
    get: () => state,
    set(patch) {
      const next = { ...state, ...patch };
      if (Object.keys(patch).every((key) => Object.is(next[key], state[key]))) return;
      state = next;
      listeners.forEach((listener) => listener(state));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
