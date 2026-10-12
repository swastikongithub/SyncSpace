import * as Y from 'yjs';

// One IndexedDB database per signed-in user, so people sharing a browser never read each
// other's offline copies, and signing out can remove exactly one person's data.
//
//   updates     autoIncrement  { docId, update }           index: docId
//   docs        keyPath docId  { docId, workspaceId, title, localVersion, durableVersion,
//                                updateCount, syncedAt, cachedAt }
//   catalog     keyPath key    cached workspace and document lists for offline navigation
//   recoveries  autoIncrement  pre-merge copies of offline work that a merge removed
const DB_VERSION = 1;
const COMPACT_AFTER = 200;

export function userDatabaseName(userId, prefix = 'syncspace') {
  return `${prefix}:user:${userId}`;
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
    tx.onerror = () => reject(tx.error);
  });
}

function emptyMeta(docId) {
  return { docId, workspaceId: null, title: '', localVersion: 0, durableVersion: 0, updateCount: 0, syncedAt: null, cachedAt: Date.now() };
}

export async function openUserStore(userId, { indexedDB = globalThis.indexedDB, prefix } = {}) {
  if (!indexedDB) throw new Error('IndexedDB is not available in this browser.');
  const open = indexedDB.open(userDatabaseName(userId, prefix), DB_VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    const updates = db.createObjectStore('updates', { autoIncrement: true });
    updates.createIndex('docId', 'docId');
    db.createObjectStore('docs', { keyPath: 'docId' });
    db.createObjectStore('catalog', { keyPath: 'key' });
    const recoveries = db.createObjectStore('recoveries', { autoIncrement: true });
    recoveries.createIndex('docId', 'docId');
  };
  const db = await request(open);
  return new UserStore(db, userId);
}

export async function deleteUserStore(userId, { indexedDB = globalThis.indexedDB, prefix } = {}) {
  await request(indexedDB.deleteDatabase(userDatabaseName(userId, prefix)));
}

export class UserStore {
  constructor(db, userId) {
    this.db = db;
    this.userId = userId;
    // Another tab upgrading or deleting this database must not be blocked by us.
    db.onversionchange = () => db.close();
  }

  close() {
    this.db.close();
  }

  /** Reads a document's local copy, compacting it first if many small updates accumulated. */
  async load(docId) {
    const tx = this.db.transaction(['updates', 'docs'], 'readonly');
    const [keys, values, meta] = await Promise.all([
      request(tx.objectStore('updates').index('docId').getAllKeys(docId)),
      request(tx.objectStore('updates').index('docId').getAll(docId)),
      request(tx.objectStore('docs').get(docId)),
      done(tx),
    ]);
    if (!meta && values.length === 0) return null;
    let updates = values.map((value) => value.update);
    if (updates.length > COMPACT_AFTER) {
      const merged = Y.mergeUpdates(updates);
      await this.#replaceUpdates(docId, keys, merged);
      updates = [merged];
    }
    return { updates, meta: meta ?? emptyMeta(docId) };
  }

  async #replaceUpdates(docId, keys, merged) {
    const tx = this.db.transaction(['updates', 'docs'], 'readwrite');
    const updates = tx.objectStore('updates');
    for (const key of keys) updates.delete(key);
    updates.add({ docId, update: merged });
    const docs = tx.objectStore('docs');
    const meta = (await request(docs.get(docId))) ?? emptyMeta(docId);
    docs.put({ ...meta, updateCount: 1 });
    await done(tx);
  }

  /**
   * Stores one update. For local edits `localVersion` is written in the same transaction, so
   * the persisted count of unsent changes can never disagree with the stored content.
   */
  async storeUpdate(docId, update, localVersion = null) {
    const tx = this.db.transaction(['updates', 'docs'], 'readwrite');
    tx.objectStore('updates').add({ docId, update });
    const docs = tx.objectStore('docs');
    const meta = (await request(docs.get(docId))) ?? emptyMeta(docId);
    docs.put({
      ...meta,
      updateCount: meta.updateCount + 1,
      localVersion: localVersion ? Math.max(meta.localVersion, localVersion) : meta.localVersion,
    });
    await done(tx);
  }

  /** Never records more stored edits than exist locally, even if called out of order. */
  async setDurable(docId, durableVersion) {
    await this.#patchMeta(docId, (meta) => ({
      ...meta,
      durableVersion: Math.min(meta.localVersion, Math.max(meta.durableVersion, durableVersion)),
    }));
  }

  async markSynced(docId) {
    await this.#patchMeta(docId, (meta) => ({ ...meta, syncedAt: Date.now() }));
  }

  async setDocInfo(docId, { workspaceId, title }) {
    await this.#patchMeta(docId, (meta) => ({
      ...meta,
      workspaceId: workspaceId ?? meta.workspaceId,
      title: title ?? meta.title,
    }));
  }

  async #patchMeta(docId, change) {
    const tx = this.db.transaction('docs', 'readwrite');
    const docs = tx.objectStore('docs');
    const meta = (await request(docs.get(docId))) ?? emptyMeta(docId);
    docs.put(change(meta));
    await done(tx);
  }

  /** Every document that has a local copy, with its pending-change count. */
  async listDocs() {
    const tx = this.db.transaction('docs', 'readonly');
    const [metas] = await Promise.all([request(tx.objectStore('docs').getAll()), done(tx)]);
    return metas
      .filter((meta) => meta.updateCount > 0)
      .map((meta) => ({ ...meta, pending: Math.max(0, meta.localVersion - meta.durableVersion) }));
  }

  async pendingDocs() {
    return (await this.listDocs()).filter((meta) => meta.pending > 0);
  }

  async removeDoc(docId) {
    const tx = this.db.transaction(['updates', 'docs'], 'readwrite');
    const keys = await request(tx.objectStore('updates').index('docId').getAllKeys(docId));
    for (const key of keys) tx.objectStore('updates').delete(key);
    tx.objectStore('docs').delete(docId);
    await done(tx);
  }

  async getCatalog(key) {
    return (await this.getCatalogEntry(key))?.value ?? null;
  }

  /** { value, savedAt } or null. */
  async getCatalogEntry(key) {
    const tx = this.db.transaction('catalog', 'readonly');
    const [entry] = await Promise.all([request(tx.objectStore('catalog').get(key)), done(tx)]);
    return entry ? { value: entry.value, savedAt: entry.savedAt } : null;
  }

  async putCatalog(key, value) {
    const tx = this.db.transaction('catalog', 'readwrite');
    tx.objectStore('catalog').put({ key, value, savedAt: Date.now() });
    await done(tx);
  }

  async addRecovery(docId, state) {
    const tx = this.db.transaction('recoveries', 'readwrite');
    const key = await request(tx.objectStore('recoveries').add({ docId, state, createdAt: Date.now(), uploaded: false }));
    await done(tx);
    return key;
  }

  async listRecoveries(docId) {
    const tx = this.db.transaction('recoveries', 'readonly');
    const store = tx.objectStore('recoveries').index('docId');
    const [keys, values] = await Promise.all([request(store.getAllKeys(docId)), request(store.getAll(docId)), done(tx)]);
    return values.map((value, index) => ({ ...value, key: keys[index] }));
  }

  async markRecoveryUploaded(key) {
    const tx = this.db.transaction('recoveries', 'readwrite');
    const store = tx.objectStore('recoveries');
    const value = await request(store.get(key));
    if (value) store.put({ ...value, uploaded: true }, key);
    await done(tx);
  }

  async removeRecovery(key) {
    const tx = this.db.transaction('recoveries', 'readwrite');
    tx.objectStore('recoveries').delete(key);
    await done(tx);
  }

  /** Storage for a single document, in the shape DocSyncSession expects. */
  forSession() {
    return {
      load: (docId) => this.load(docId),
      storeUpdate: (docId, update, version) => this.storeUpdate(docId, update, version),
      setDurable: (docId, version) => this.setDurable(docId, version),
      markSynced: (docId) => this.markSynced(docId),
    };
  }
}
