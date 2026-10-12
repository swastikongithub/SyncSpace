# ADR 0003: Append-only update log, checkpoints, and versions

- Status: accepted
- Date: 2026-10-12

## Context

Durable content must survive restarts and crashes. The specification warns against storing an unlimited history of binary updates in one growing MongoDB document, and asks for practical version history that does not treat presence as revisions.

## Decision

Three collections, with three separate jobs:

| Collection | Shape | Job |
|---|---|---|
| `docupdates` | `{ docId, seq, update, userId, createdAt }`, unique `(docId, seq)` | Append-only log of *effective* Yjs updates, one small record each. The unique index means two writers can never both claim a log position. |
| `doccheckpoints` | `{ docId, seq, state }`, one per document | Compacted state covering every update with `seq <= checkpoint.seq`. |
| `docversions` | `{ docId, kind, label, state, title, excerpt, wordCount, createdBy, contributors, restoredFrom }` | Self-contained snapshots for history. Independent of compaction. |

**Loading** = checkpoint + updates with `seq > checkpoint.seq`.

**Compaction** runs inside the document's write queue once 200 updates accumulate (and when a room unloads). It writes the checkpoint *first*, then deletes the covered updates. A crash between the two leaves redundant updates, which are idempotent when replayed. A checkpoint never moves backwards: the upsert is filtered on `seq < new seq`.

**Versions.** Yjs runs with garbage collection on, so past states can't be reconstructed from the log. History is kept as full snapshots instead:

- *automatic*: when a room unloads after changes, and every 10 minutes during continuous editing; the newest 50 are kept per document;
- *manual* (named) versions, never pruned;
- *restore* writes a `pre-restore` safety copy and a `restore` record. The current state is captured and the restore applied in one synchronous step, so no concurrent edit can fall between them;
- *recovered*: a client's pre-merge offline copy (ADR 0004).

**Restore is a forward change.** The live fragment's blocks are deleted and copies of the old version's blocks are inserted, in one transaction that flows through the normal persist-and-broadcast path. Collaborators receive it as an ordinary update. An offline collaborator's new paragraphs merge in after reconnecting (tested in `history.test.js`). Edits they made *inside* paragraphs the restore removed follow CRDT delete-wins semantics, and are preserved by the recovery mechanism.

## Consequences

- No unbounded documents: log records are small and compaction bounds their count per document.
- MongoDB's 16 MB document limit caps the size of a single checkpoint or version. That is far beyond typical text documents, but it is a documented limit (GridFS would lift it).
- Version storage grows with document size × version count. Automatic versions are capped; named ones are not.
- Presence never touches these collections.
