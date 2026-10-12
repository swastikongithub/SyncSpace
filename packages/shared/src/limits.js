export const LIMITS = Object.freeze({
  userNameMax: 60,
  emailMax: 254,
  passwordMin: 10,
  passwordMax: 128,
  workspaceNameMax: 80,
  documentTitleMax: 200,
  versionLabelMax: 80,
  searchQueryMax: 100,
  /** Largest single WebSocket frame accepted from a client (a large paste fits comfortably). */
  wsMessageMaxBytes: 4 * 1024 * 1024,
  /** Awareness carries presence only: identity, cursor, typing state. */
  awarenessMaxBytes: 16 * 1024,
  /** Raw Yjs state accepted when uploading a recovered offline copy. */
  recoveredStateMaxBytes: 8 * 1024 * 1024,
});
