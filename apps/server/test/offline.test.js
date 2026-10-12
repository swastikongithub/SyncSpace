import { IDBFactory } from 'fake-indexeddb';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { manualNetwork, openUserStore } from '@syncspace/sync-client';
import {
  addMember,
  bodyText,
  createDocument,
  createWorkspace,
  openSession,
  registerUser,
  startTestServer,
  waitFor,
  waitForDurable,
  waitForSynced,
} from './helpers.js';

let harness;
let owner;
let editor;
let workspace;
const cleanup = [];

function appendParagraph(doc, text) {
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.insert(0, [new Y.XmlText(text)]);
  const fragment = doc.getXmlFragment('default');
  fragment.insert(fragment.length, [paragraph]);
}

/** A simulated browser: its own IndexedDB, network switch and signed-in user. */
async function device(client) {
  const indexedDB = new IDBFactory();
  const store = await openUserStore(client.user.id, { indexedDB });
  const network = manualNetwork(true);
  cleanup.push(() => store.close());
  return {
    store,
    network,
    open(docId) {
      const session = openSession(harness, client, docId, { storage: store.forSession(), network });
      cleanup.push(() => session.destroy());
      return session;
    },
  };
}

beforeAll(async () => {
  harness = await startTestServer();
  [owner, editor] = await Promise.all([registerUser(harness, { name: 'Owner' }), registerUser(harness, { name: 'Editor' })]);
  workspace = await createWorkspace(owner);
  await addMember(owner, editor, workspace.id, 'editor');
});
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
afterAll(async () => {
  await harness.stop();
});

describe('offline editing', () => {
  it('keeps editing offline, survives a reload, and merges with concurrent remote edits on reconnect', async () => {
    const doc = await createDocument(owner, workspace.id, 'Field notes');
    const laptop = await device(owner);
    const online = await device(editor);

    const a = laptop.open(doc.id);
    const b = online.open(doc.id);
    await Promise.all([a.start(), b.start()]);
    await Promise.all([waitForSynced(a), waitForSynced(b)]);

    laptop.network.set(false);
    await waitFor(() => a.state.connection === 'offline', { message: 'offline state' });
    appendParagraph(a.doc, 'written on the train');
    appendParagraph(a.doc, 'still on the train');
    appendParagraph(b.doc, 'written at the desk');
    await a.whenSavedLocally();
    expect(a.pendingCount).toBe(2);
    expect(a.state.savedVersion).toBe(2);

    // Reload the page while still offline: the copy and the count of unsent changes come back.
    await a.destroy();
    const reloaded = laptop.open(doc.id);
    await reloaded.start();
    expect(reloaded.state.connection).toBe('offline');
    expect(reloaded.state.hasLocalCopy).toBe(true);
    expect(reloaded.pendingCount).toBe(2);
    expect(bodyText(reloaded.doc)).toContain('written on the train');

    laptop.network.set(true);
    await waitForDurable(reloaded);
    await waitFor(() => bodyText(b.doc).includes('still on the train') && bodyText(reloaded.doc).includes('written at the desk'), {
      message: 'both sides merged',
    });
    expect(bodyText(reloaded.doc)).toBe(bodyText(b.doc));
    const metas = await laptop.store.listDocs();
    expect(metas.find((meta) => meta.docId === doc.id).pending).toBe(0);
  });

  it('reports a document that was never opened on this device as unavailable offline', async () => {
    const doc = await createDocument(owner, workspace.id);
    const fresh = await device(owner);
    fresh.network.set(false);
    const s = fresh.open(doc.id);
    await s.start();
    expect(s.state.connection).toBe('offline');
    expect(s.state.hasLocalCopy).toBe(false);
    expect(s.state.serverSynced).toBe(false);
    expect(await fresh.store.listDocs()).toEqual([]);
  });

  it('does not count a change as stored when the connection drops before the acknowledgement', async () => {
    const doc = await createDocument(owner, workspace.id);
    const phone = await device(owner);
    const s = phone.open(doc.id);
    await s.start();
    await waitForSynced(s);

    const { store } = harness.server.ctx;
    const append = store.append;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    store.append = async (...args) => {
      await gate;
      return append(...args);
    };
    try {
      appendParagraph(s.doc, 'interrupted');
      await new Promise((resolve) => setTimeout(resolve, 50));
      s.socket.terminate();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(s.pendingCount).toBe(1);
    } finally {
      store.append = append;
      release();
    }
    await waitForDurable(s);
    const fresh = (await device(editor)).open(doc.id);
    await fresh.start();
    await waitForSynced(fresh);
    expect(bodyText(fresh.doc).match(/interrupted/g)).toHaveLength(1);
  });

  it('survives rapid repeated disconnects while editing', async () => {
    const doc = await createDocument(owner, workspace.id);
    const flaky = await device(owner);
    const steady = await device(editor);
    const a = flaky.open(doc.id);
    const b = steady.open(doc.id);
    await Promise.all([a.start(), b.start()]);
    await Promise.all([waitForSynced(a), waitForSynced(b)]);

    for (let i = 0; i < 12; i += 1) {
      appendParagraph(a.doc, `flaky ${i}`);
      if (i % 3 === 0) appendParagraph(b.doc, `steady ${i}`);
      flaky.network.set(i % 2 === 0 ? false : true);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    flaky.network.set(true);
    await Promise.all([waitForDurable(a), waitForDurable(b)]);
    await waitFor(() => bodyText(a.doc) === bodyText(b.doc), { message: 'convergence after flapping' });
    for (let i = 0; i < 12; i += 1) expect(bodyText(a.doc).match(new RegExp(`flaky ${i}\\b`, 'g'))).toHaveLength(1);
  });

  it('reconnects after a server restart that happened while the device was offline', async () => {
    const doc = await createDocument(owner, workspace.id);
    const laptop = await device(owner);
    const s = laptop.open(doc.id);
    await s.start();
    await waitForSynced(s);
    laptop.network.set(false);
    appendParagraph(s.doc, 'offline across a restart');
    await harness.restart({ graceful: false });
    laptop.network.set(true);
    await waitForDurable(s);
    const check = (await device(editor)).open(doc.id);
    await check.start();
    await waitForSynced(check);
    expect(bodyText(check.doc)).toContain('offline across a restart');
  });
});

describe('recovering offline work removed by a merge', () => {
  it('emits the pre-merge state when a collaborator deleted the paragraph holding unsent text', async () => {
    const doc = await createDocument(owner, workspace.id);
    const laptop = await device(owner);
    const desk = await device(editor);
    const a = laptop.open(doc.id);
    const b = desk.open(doc.id);
    await Promise.all([a.start(), b.start()]);
    await Promise.all([waitForSynced(a), waitForSynced(b)]);
    appendParagraph(b.doc, 'shared paragraph');
    await waitFor(() => bodyText(a.doc).includes('shared paragraph'), { message: 'shared paragraph arrives' });

    laptop.network.set(false);
    const paragraphA = a.doc.getXmlFragment('default').toArray().find((node) => node.toString().includes('shared paragraph'));
    paragraphA.get(0).insert(paragraphA.get(0).length, ' plus my unsent thoughts');

    const fragmentB = b.doc.getXmlFragment('default');
    const index = fragmentB.toArray().findIndex((node) => node.toString().includes('shared paragraph'));
    fragmentB.delete(index, 1);
    await waitForDurable(b);

    const recoveries = [];
    a.on('recovery', (event) => recoveries.push(event));
    laptop.network.set(true);
    await waitForDurable(a);
    await waitFor(() => recoveries.length === 1, { message: 'recovery event' });

    expect(bodyText(a.doc)).not.toContain('unsent thoughts');
    const preMerge = new Y.Doc();
    Y.applyUpdate(preMerge, recoveries[0].state);
    expect(bodyText(preMerge)).toContain('shared paragraph plus my unsent thoughts');
  });

  it('stays quiet when remote deletions only touch content the server already had', async () => {
    const doc = await createDocument(owner, workspace.id);
    const laptop = await device(owner);
    const desk = await device(editor);
    const a = laptop.open(doc.id);
    const b = desk.open(doc.id);
    await Promise.all([a.start(), b.start()]);
    await Promise.all([waitForSynced(a), waitForSynced(b)]);
    appendParagraph(b.doc, 'old paragraph');
    await waitFor(() => bodyText(a.doc).includes('old paragraph'), { message: 'arrives' });

    laptop.network.set(false);
    appendParagraph(a.doc, 'my new paragraph');
    const fragmentB = b.doc.getXmlFragment('default');
    fragmentB.delete(fragmentB.toArray().findIndex((node) => node.toString().includes('old paragraph')), 1);
    await waitForDurable(b);

    const recoveries = [];
    a.on('recovery', (event) => recoveries.push(event));
    laptop.network.set(true);
    await waitForDurable(a);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(recoveries).toHaveLength(0);
    expect(bodyText(a.doc)).toContain('my new paragraph');
    expect(bodyText(a.doc)).not.toContain('old paragraph');
  });
});

describe('local storage per account', () => {
  it('keeps each account’s offline copies in its own database', async () => {
    const indexedDB = new IDBFactory();
    const mine = await openUserStore(owner.user.id, { indexedDB });
    const theirs = await openUserStore(editor.user.id, { indexedDB });
    try {
      await mine.storeUpdate('doc-1', new Uint8Array([0, 0]), 1);
      expect((await mine.listDocs()).map((meta) => meta.docId)).toEqual(['doc-1']);
      expect(await theirs.listDocs()).toEqual([]);
      expect((await mine.pendingDocs()).map((meta) => meta.pending)).toEqual([1]);
    } finally {
      mine.close();
      theirs.close();
    }
  });
});
