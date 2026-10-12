import { describe, expect, it } from 'vitest';
import { describeSync, transitionMessage } from './status.js';

const base = {
  connection: 'connected',
  role: 'editor',
  serverSynced: true,
  hasLocalCopy: true,
  localVersion: 10,
  savedVersion: 10,
  durableVersion: 10,
  localWritesPending: 0,
  localError: null,
  blocked: null,
  readOnlyRejected: false,
  lastServerContactAt: 1_000,
  retryAt: null,
};

describe('describeSync', () => {
  it('only claims "stored on server" when every local change is acknowledged', () => {
    expect(describeSync(base, { now: 2_000 }).headline).toBe('Stored on server');
    const sending = describeSync({ ...base, localVersion: 12 }, { now: 2_000 });
    expect(sending.headline).toBe('Sending…');
    expect(sending.server.label).toBe('Storing your changes…');
    expect(sending.server.detail).toBe('2 edits from this device haven’t reached the server yet.');
    expect(sending.mark).toBe('sending');
  });

  it('describes offline work as saved on this device only, with an exact count', () => {
    const offline = describeSync({ ...base, connection: 'offline', localVersion: 11 });
    expect(offline.headline).toBe('Saved on this device only');
    expect(offline.server.detail).toBe('1 edit from this device hasn’t reached the server yet.');
    expect(offline.mark).toBe('held');
    expect(offline.device.label).toBe('Saved on this device');
  });

  it('does not claim local durability while a local write is in flight or failed', () => {
    expect(describeSync({ ...base, localWritesPending: 1 }).device.label).toBe('Saving on this device…');
    const failed = describeSync({ ...base, localError: { code: 'quota', message: 'Out of space.' } });
    expect(failed.device.tone).toBe('error');
    expect(failed.mark).toBe('fault');
  });

  it('is explicit when nothing is kept on this device', () => {
    const memoryOnly = describeSync({ ...base, connection: 'offline', localVersion: 13 }, { hasStorage: false });
    expect(memoryOnly.headline).toBe('Not saved anywhere yet');
    expect(memoryOnly.device.label).toBe('Not kept on this device');
  });

  it('explains terminal disconnections', () => {
    const signedOut = describeSync({ ...base, connection: 'blocked', blocked: { code: 4401 }, localVersion: 14 });
    expect(signedOut.headline).toBe('Signed out');
    expect(signedOut.server.detail).toContain('4 edits from this device haven’t reached the server yet.');
    expect(describeSync({ ...base, connection: 'blocked', blocked: { code: 4403 } }).headline).toBe('Access removed');
  });

  it('tells viewers their edits were not accepted', () => {
    const rejected = describeSync({ ...base, role: 'viewer', readOnlyRejected: true, localVersion: 11 });
    expect(rejected.headline).toBe('Edits not accepted');
    expect(rejected.server.detail).toContain('Your role is viewer.');
    expect(describeSync({ ...base, role: 'viewer' }).headline).toBe('Up to date');
  });

  it('shows the retry countdown while reconnecting', () => {
    const waiting = describeSync({ ...base, connection: 'waiting', retryAt: 10_000 }, { now: 6_500 });
    expect(waiting.server.label).toBe('Not reachable: retrying in 4s');
    expect(waiting.headline).toBe('Reconnecting…');
  });

  it('shows loading before a first copy exists', () => {
    expect(describeSync({ ...base, hasLocalCopy: false, serverSynced: false, connection: 'handshaking' }).headline).toBe('Loading…');
  });
});

describe('transitionMessage', () => {
  it('announces going offline and coming back, and stays quiet otherwise', () => {
    const online = describeSync(base);
    const offline = describeSync({ ...base, connection: 'offline', localVersion: 11 });
    const back = describeSync({ ...base, localVersion: 11, durableVersion: 11 });
    expect(transitionMessage(online, offline)).toMatch(/^Offline\./);
    expect(transitionMessage(offline, back)).toMatch(/^Back online\./);
    expect(transitionMessage(online, online)).toBeNull();
  });
});
