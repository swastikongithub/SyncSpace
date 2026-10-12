// Randomised convergence tests.
//  1. Pure CRDT level: random edits on N replicas, updates delivered in random order with
//     duplicates, must converge (fast, many runs).
//  2. Whole system: random edits on real sync clients through the real server, with random
//     network loss and server crashes in between, must converge and match a fresh load.
import fc from 'fast-check';
import { IDBFactory } from 'fake-indexeddb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { manualNetwork, openUserStore } from '@syncspace/sync-client';
import {
  addMember,
  createDocument,
  createWorkspace,
  openSession,
  registerUser,
  startTestServer,
  waitFor,
  waitForDurable,
  waitForSynced,
} from './helpers.js';

const fragmentOf = (doc) => doc.getXmlFragment('default');

/** Applies one abstract operation to a replica, mirroring what the editor produces. */
function applyOp(doc, op) {
  const fragment = fragmentOf(doc);
  const blocks = fragment.toArray();
  if (op.kind === 'insertParagraph' || blocks.length === 0) {
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText(op.text)]);
    fragment.insert(op.at % (blocks.length + 1), [paragraph]);
    return;
  }
  const block = blocks[op.at % blocks.length];
  if (op.kind === 'deleteParagraph') {
    fragment.delete(op.at % blocks.length, 1);
    return;
  }
  let text = block.toArray().find((child) => child instanceof Y.XmlText);
  if (!text) {
    text = new Y.XmlText();
    block.insert(0, [text]);
  }
  if (op.kind === 'insertText') text.insert(op.offset % (text.length + 1), op.text);
  else if (op.kind === 'deleteText' && text.length > 0) {
    const start = op.offset % text.length;
    text.delete(start, Math.min(op.length, text.length - start));
  } else if (op.kind === 'format' && text.length > 0) {
    const start = op.offset % text.length;
    text.format(start, Math.min(op.length, text.length - start), { bold: {} });
  }
}

const opArbitrary = fc.record({
  kind: fc.constantFrom('insertParagraph', 'insertText', 'insertText', 'deleteText', 'deleteParagraph', 'format'),
  at: fc.nat(50),
  offset: fc.nat(80),
  length: fc.integer({ min: 1, max: 6 }),
  text: fc.string({ minLength: 1, maxLength: 6, unit: fc.constantFrom('a', 'b', 'c', ' ', 'é', '✓') }),
});

describe('CRDT convergence under arbitrary delivery order', () => {
  it('replicas converge regardless of order and duplication of delivered updates', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.nat(2), opArbitrary), { minLength: 1, maxLength: 40 }),
        fc.array(fc.nat(), { maxLength: 400 }),
        (script, shuffleSeed) => {
          const replicas = [new Y.Doc(), new Y.Doc(), new Y.Doc()];
          const produced = [];
          replicas.forEach((doc, index) => doc.on('update', (update, origin) => origin !== 'net' && produced.push({ from: index, update })));
          for (const [index, op] of script) applyOp(replicas[index], op);

          // Every replica receives every other replica's updates in its own random order,
          // some of them twice.
          replicas.forEach((doc, index) => {
            const inbox = produced.filter((entry) => entry.from !== index).map((entry) => entry.update);
            for (let i = 0; i < inbox.length; i += 1) {
              const j = (shuffleSeed[i] ?? i) % inbox.length;
              [inbox[i], inbox[j]] = [inbox[j], inbox[i]];
            }
            const withDuplicates = [...inbox, ...inbox.filter((_, i) => (shuffleSeed[i] ?? 0) % 3 === 0)];
            for (const update of withDuplicates) Y.applyUpdate(doc, update, 'net');
          });

          const [first, ...rest] = replicas.map((doc) => fragmentOf(doc).toString());
          for (const other of rest) expect(other).toBe(first);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('system convergence through the server', () => {
  let harness;
  let users;
  let workspace;

  beforeAll(async () => {
    harness = await startTestServer({ collabSettings: { compactAfterUpdates: 25 } });
    users = await Promise.all([registerUser(harness), registerUser(harness), registerUser(harness)]);
    workspace = await createWorkspace(users[0]);
    await addMember(users[0], users[1], workspace.id, 'editor');
    await addMember(users[0], users[2], workspace.id, 'editor');
  });
  afterAll(async () => {
    await harness.stop();
  });

  const stepArbitrary = fc.oneof(
    { weight: 8, arbitrary: fc.record({ type: fc.constant('edit'), client: fc.nat(2), op: opArbitrary }) },
    { weight: 2, arbitrary: fc.record({ type: fc.constant('network'), client: fc.nat(2), online: fc.boolean() }) },
    { weight: 1, arbitrary: fc.record({ type: fc.constant('pause'), ms: fc.integer({ min: 1, max: 30 }) }) },
    { weight: 1, arbitrary: fc.record({ type: fc.constant('crash') }) },
  );

  it('random edits, disconnects and server crashes always converge to the stored state', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(stepArbitrary, { minLength: 5, maxLength: 30 }), async (steps) => {
        const doc = await createDocument(users[0], workspace.id, 'Property');
        const devices = await Promise.all(
          users.map(async (user) => {
            const store = await openUserStore(user.user.id, { indexedDB: new IDBFactory() });
            const network = manualNetwork(true);
            const session = openSession(harness, user, doc.id, { storage: store.forSession(), network });
            return { store, network, session };
          }),
        );
        try {
          await Promise.all(devices.map(({ session }) => session.start()));
          await Promise.all(devices.map(({ session }) => waitForSynced(session)));
          for (const step of steps) {
            if (step.type === 'edit') applyOp(devices[step.client].session.doc, step.op);
            else if (step.type === 'network') devices[step.client].network.set(step.online);
            else if (step.type === 'pause') await new Promise((resolve) => setTimeout(resolve, step.ms));
            else if (step.type === 'crash') await harness.restart({ graceful: false });
          }
          for (const device of devices) device.network.set(true);
          await Promise.all(devices.map(({ session }) => waitForDurable(session, 'all changes stored', { timeout: 10_000 })));
          await waitFor(
            () => new Set(devices.map(({ session }) => fragmentOf(session.doc).toString())).size === 1,
            { message: 'replicas to converge', timeout: 10_000 },
          );

          await harness.restart({ graceful: false });
          const verifier = openSession(harness, users[0], doc.id);
          await verifier.start();
          await waitForSynced(verifier);
          expect(fragmentOf(verifier.doc).toString()).toBe(fragmentOf(devices[0].session.doc).toString());
          await verifier.destroy();
        } finally {
          for (const { session, store } of devices) {
            await session.destroy();
            store.close();
          }
        }
      }),
      { numRuns: 15 },
    );
  }, 240_000);
});
