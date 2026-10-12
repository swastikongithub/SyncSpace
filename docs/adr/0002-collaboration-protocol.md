# ADR 0002: Yjs over a custom WebSocket protocol with durability acknowledgements

- Status: accepted
- Date: 2026-10-12

## Context

The product must never claim a change is stored on the server without evidence, and must distinguish "saved on this device" from "stored on the server". It must also enforce authorization on every socket join and message, and keep presence separate from document content.

**CRDT vs OT.** Operational transformation needs a central server to transform concurrent operations and does not naturally support long offline periods. A CRDT (Yjs) merges concurrent and offline edits deterministically on every replica, which is the core requirement. The specification forbids a custom CRDT, so Yjs is used unchanged.

Off-the-shelf transports were considered:

| Option | Why not |
|---|---|
| `y-websocket` server | No authorization hooks per message, and no notion of "stored": the server echoes sync status after applying in memory. |
| Hocuspocus | Good auth hooks and debounced storage, but its sync acknowledgement means "applied in memory". Persistence is debounced seconds later, so it cannot back an honest "stored on server" claim. |

## Decision

A small custom protocol (`packages/shared/src/protocol.js`) carrying standard Yjs payloads:

- `SyncStep1` / `SyncStep2` / `Update`: state vectors and Yjs updates, as in the standard Yjs sync exchange.
- Client frames that carry data include an **`ackId`**. The server answers **`Ack(ackId)` only after every write caused by that frame, and by all earlier frames on that connection, has been committed to MongoDB.**
- `Awareness` (presence) uses y-protocols' encoding but is **never persisted**. The server rewrites the `user` field with the authenticated identity and binds each awareness client ID to the connection that introduced it.
- `Control` messages: hello (role), role changes, errors (`read_only`, `persistence_failed`), restore notices.
- Close codes 4401/4403/4404/4410 are terminal (the client stops retrying and explains why); everything else reconnects with backoff.

On the client, every local change increments a persisted `localVersion`. Each frame records which `localVersion` it covers. An Ack advances `durableVersion`, so `localVersion - durableVersion` is an exact, persistent count of changes that exist only on this device. After any reconnect, the client's `SyncStep2` (computed against the server's state vector) contains everything the server lacks, deletions included, so unacknowledged frames are never lost and never need tracking individually.

**Server ordering.** Updates are applied to the in-memory `Y.Doc` immediately (low collaborator latency), and the *effective* update Yjs emits is queued for persistence. A single serial write queue per document batches inserts with `insertMany` and sends Acks after the batch commits. Replayed or duplicate frames produce no effective update and therefore no stored record.

**Failure rule.** If a write fails, the room is evicted and every connection is closed with 4500. Clients reconnect to a replica freshly loaded from MongoDB and resend everything unacknowledged. This avoids the trap where the server's in-memory state contains a change the database doesn't, which would make a later handshake skip resending it.

## Consequences

- "Stored on server" in the UI is backed by a database commit, verified by tests (`collab.test.js`: ack-after-durable, write-failure eviction, crash survival).
- Viewers' frames are rejected unless they carry nothing new, and their client keeps the edits pending with an explicit "can't be saved" state instead of silently dropping them.
- One socket per open document is simple and adequate for this product's scale. Multiplexing documents over one socket is a possible later optimisation.
- A malicious *editor* could still craft Yjs updates with forged client IDs. That is an integrity risk inside a trusted role, not an authorization bypass, and is noted as a limitation.
