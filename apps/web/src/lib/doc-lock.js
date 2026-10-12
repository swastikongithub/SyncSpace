// One editing session per document per browser profile (Web Locks API).
//
// Two tabs editing the same document would both write to the same local database and could
// claim each other's changes as stored. Instead, the first tab holds the lock and a second tab
// is offered "Edit here instead", which takes the lock over and the first tab steps aside.
//
// Within one tab the lock is reference-counted and released after a short grace period, so a
// remount (React StrictMode, or navigating away and straight back) reuses the lock instead of
// racing its own release and reporting the document as open elsewhere.

const RELEASE_GRACE_MS = 250;
const entries = new Map(); // name -> { ready: Promise<boolean>, refs, timer, release, stolen }

function requestLock(name, steal) {
  let release;
  let markStolen;
  const held = new Promise((done) => {
    release = done;
  });
  const stolen = new Promise((done) => {
    markStolen = done;
  });
  const ready = new Promise((resolve) => {
    navigator.locks
      .request(name, steal ? { steal: true } : { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(false);
          return undefined;
        }
        resolve(true);
        return held;
      })
      .catch((error) => {
        // Another tab took the lock over.
        if (error?.name === 'AbortError') markStolen();
      });
  });
  return { ready, release, stolen, refs: 0, timer: null };
}

/**
 * @returns {Promise<{ release(): void, stolen: Promise<void> } | null>} null if another tab holds it.
 */
export async function acquireDocLock(name, { steal = false } = {}) {
  if (!globalThis.navigator?.locks) {
    // Very old browsers: no coordination available, behave as if we hold the lock.
    return { release() {}, stolen: new Promise(() => {}) };
  }

  let entry = entries.get(name);
  if (!entry || steal) {
    entry?.release();
    entry = requestLock(name, steal);
    entries.set(name, entry);
    entry.stolen.then(() => {
      if (entries.get(name) === entry) entries.delete(name);
    });
  }
  entry.refs += 1;
  clearTimeout(entry.timer);

  if (!(await entry.ready)) {
    entry.refs -= 1;
    if (entries.get(name) === entry) entries.delete(name);
    return null;
  }

  let released = false;
  return {
    stolen: entry.stolen,
    release() {
      if (released) return;
      released = true;
      entry.refs -= 1;
      if (entry.refs > 0) return;
      entry.timer = setTimeout(() => {
        if (entry.refs > 0) return;
        entry.release();
        if (entries.get(name) === entry) entries.delete(name);
      }, RELEASE_GRACE_MS);
    },
  };
}
