// Translates sync-engine state into what the interface says. Every sentence here must be
// literally true of the engine state it is derived from; see docs/design.md, "Say exactly what
// is true".

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const BLOCKED = {
  4401: { label: 'Signed out', detail: 'Sign in again to keep syncing. Your edits stay on this device meanwhile.' },
  4403: { label: 'Access removed', detail: 'You are no longer a member of this workspace, so changes cannot be sent.' },
  4404: { label: 'Not available', detail: 'This document does not exist or you no longer have access to it.' },
  4410: { label: 'Document closed', detail: 'This document was moved to the trash or deleted.' },
};

/**
 * @param {object} state  DocSyncSession state
 * @param {object} context { hasStorage, now }
 */
export function describeSync(state, { hasStorage = true, now = Date.now() } = {}) {
  const pending = Math.max(0, state.localVersion - state.durableVersion);
  const connected = state.connection === 'connected';
  const readOnly = state.role === 'viewer';

  // ---- This device ----------------------------------------------------------------------
  let device;
  if (!hasStorage) {
    device = {
      tone: 'none',
      label: 'Not kept on this device',
      detail: 'This browser is not allowing offline storage, so unsent edits exist only in this tab.',
    };
  } else if (state.localError) {
    device = { tone: 'error', label: 'Couldn’t save on this device', detail: state.localError.message };
  } else if (state.localWritesPending > 0) {
    device = { tone: 'busy', label: 'Saving on this device…', detail: null };
  } else if (state.hasLocalCopy) {
    device = { tone: 'ok', label: 'Saved on this device', detail: 'Available offline in this browser.' };
  } else {
    device = { tone: 'busy', label: 'Not on this device yet', detail: 'A copy is kept here once the document has loaded.' };
  }

  // ---- Server ----------------------------------------------------------------------------
  let server;
  const blocked = state.blocked ? (BLOCKED[state.blocked.code] ?? { label: 'Disconnected', detail: 'The server closed the connection.' }) : null;
  const unsent = pending > 0 ? `${plural(pending, 'edit', 'edits')} from this device ${pending === 1 ? 'hasn’t' : 'haven’t'} reached the server yet.` : null;
  if (blocked) {
    server = { tone: 'error', label: blocked.label, detail: [blocked.detail, unsent].filter(Boolean).join(' ') };
  } else if (state.readOnlyRejected) {
    server = {
      tone: 'error',
      label: 'Can’t accept edits from you',
      detail: `Your role is viewer. ${unsent ?? ''} They are kept on this device.`.trim(),
    };
  } else if (connected && pending === 0) {
    server = {
      tone: 'ok',
      label: readOnly ? 'Up to date' : 'Has all your changes',
      detail: state.lastServerContactAt ? `Confirmed ${secondsAgo(state.lastServerContactAt, now)}.` : null,
    };
  } else if (connected) {
    server = { tone: 'busy', label: 'Storing your changes…', detail: unsent };
  } else if (state.connection === 'offline') {
    server = { tone: 'away', label: 'Not reachable: you’re offline', detail: unsent ?? 'Edits will sync when you reconnect.' };
  } else if (state.connection === 'waiting') {
    const seconds = state.retryAt ? Math.max(1, Math.ceil((state.retryAt - now) / 1000)) : null;
    server = {
      tone: 'away',
      label: seconds ? `Not reachable: retrying in ${seconds}s` : 'Not reachable: retrying',
      detail: unsent ?? 'Edits will sync when the connection returns.',
    };
  } else {
    server = { tone: 'busy', label: 'Connecting…', detail: unsent };
  }

  // ---- Summary ---------------------------------------------------------------------------
  const fault = Boolean(blocked) || state.readOnlyRejected || device.tone === 'error';
  let mark;
  if (fault) mark = 'fault';
  else if (connected) mark = pending > 0 ? 'sending' : 'register';
  else mark = pending > 0 ? 'held' : 'idle';

  let headline;
  if (blocked) headline = blocked.label;
  else if (state.readOnlyRejected) headline = 'Edits not accepted';
  else if (device.tone === 'error') headline = 'Couldn’t save on this device';
  else if (!state.hasLocalCopy && !state.serverSynced) headline = 'Loading…';
  else if (connected && pending === 0) headline = readOnly ? 'Up to date' : 'Stored on server';
  else if (connected) headline = 'Sending…';
  else if (pending > 0) headline = hasStorage ? 'Saved on this device only' : 'Not saved anywhere yet';
  else if (state.connection === 'offline') headline = 'Offline';
  else headline = 'Reconnecting…';

  return { device, server, mark, headline, pending, connected, fault };
}

function secondsAgo(at, now) {
  const seconds = Math.round((now - at) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? 'a minute ago' : `${minutes} minutes ago`;
}

/** A short sentence for screen readers when the summary changes meaningfully. */
export function transitionMessage(previous, next) {
  if (!previous || previous.headline === next.headline) return null;
  if (next.mark === 'fault') return `${next.headline}. ${next.server.detail ?? ''}`.trim();
  if (next.headline === 'Offline' || next.headline === 'Saved on this device only') {
    return 'Offline. Your edits are saved on this device and will sync when you reconnect.';
  }
  if ((previous.mark === 'held' || previous.mark === 'idle' || previous.mark === 'fault') && next.mark === 'register') {
    return 'Back online. Everything on this device is stored on the server.';
  }
  return null;
}
