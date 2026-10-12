// Hands a document's local copy from one session to the next within this tab.
//
// Only one session may read and write a document's local storage at a time. When an editor
// closes (navigation, remount) its last writes may still be flushing; the next session for the
// same document must start only after that, or it would load a copy missing those writes.
// Background syncing yields to an editor that wants the document.

const teardowns = new Map(); // key -> Promise (previous session finishing)
const background = new Map(); // key -> () => Promise (stop a background session)

export function trackTeardown(key, promise) {
  const settled = promise.catch(() => {});
  teardowns.set(key, settled);
  settled.then(() => {
    if (teardowns.get(key) === settled) teardowns.delete(key);
  });
}

/** Waits until no other session in this tab is using the document. */
export async function claimDocument(key) {
  const stop = background.get(key);
  if (stop) await stop();
  await teardowns.get(key);
}

export function isDocumentBusy(key) {
  return teardowns.has(key) || background.has(key);
}

export function registerBackground(key, stop) {
  background.set(key, stop);
  return () => {
    if (background.get(key) === stop) background.delete(key);
  };
}
