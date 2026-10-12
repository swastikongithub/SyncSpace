# ADR 0004: Offline storage, single-tab editing, and account isolation

- Status: accepted
- Date: 2026-10-12

## Context

Users must keep editing documents that are available locally while offline, never silently lose local changes, see an honest status, and be safe on shared browsers. The specification suggests "a compatible Yjs persistence integration" for IndexedDB.

## Decision

### A Yjs-compatible IndexedDB store instead of `y-indexeddb`

`y-indexeddb` stores Yjs updates well, but (a) does not expose when a write has committed, and (b) cannot store metadata atomically with an update. SyncSpace needs both, to say "saved on this device" truthfully and to persist the exact count of unsent changes. `packages/sync-client/src/idb-storage.js` therefore:

- stores the same Yjs updates, plus per-document metadata (`localVersion`, `durableVersion`, `syncedAt`), **in one transaction per local change**;
- compacts a document's updates into one merged update after 200 records;
- keeps an offline **catalog** (last fetched workspace and document lists, document metadata) for navigation without a network;
- keeps **recoveries**: pre-merge copies of offline work (below).

### One database per user

The database name includes the user id (`syncspace:user:<id>`). A different account signing in on the same browser opens a different database and never sees the previous user's copies.

### What is available offline

A document is available offline once it has been **opened and synced at least once on this device**. Lists mark such documents "On this device". Opening any other document while offline shows "This document isn't on this device yet" rather than an empty editor. Creating documents and workspaces, inviting people and restoring versions require the server and say so.

### One editing tab per document (Web Locks)

Two tabs editing the same document would both write the same local database and could credit each other's changes as stored. Each document session holds a Web Lock (`syncspace:<user>:<doc>`). A second tab shows "open in another tab" with **Edit here instead**, which steals the lock; the first tab steps aside. Browsers without Web Locks fall back to no coordination.

### Recovering offline work removed by a merge

CRDTs let a deletion win over concurrent edits inside the deleted range. When a device reconnects with unsent changes, the engine snapshots its pre-merge state. It then watches the merge for deletions of content the server has never seen (item clocks at or above the server's state vector). If any are found, the pre-merge copy is saved to IndexedDB, uploaded as a `recovered` version, and the user is told where to find it.

### Sessions and sign-out

- **Booting offline**: the last signed-in user's id, name and email (no tokens) are remembered in `localStorage`, so their local database can open without a network. The UI labels this state as offline and unverified until the server confirms the session.
- **Session expiry while editing**: editing continues locally; a dialog asks the user to sign in again; on success the document reconnects and sends pending changes.
- **Sign-out with pending changes**: the dialog lists the affected documents and offers *Keep my offline copies* (sent at the next sign-in on this device) or *Erase my offline copies* (requires explicitly confirming the loss).
- **Sign-out while offline**: local state is cleared immediately and a flag makes the app call the server's logout the next time it is online. The UI says the server session ends then.

### App shell

A service worker (vite-plugin-pwa / Workbox) precaches the built app so it opens without a network. Document data never goes through the service worker.

## Consequences

- The status shown in the UI is derived from committed facts: an IndexedDB transaction completing, and a server Ack after a MongoDB commit.
- IndexedDB is not encrypted at rest. On shared computers users should choose "erase" on sign-out; the dialog recommends it.
- Per-paragraph "wet ink" marks are session-scoped (they are editor decorations); after a reload the exact *count* of unsent edits is still shown.
