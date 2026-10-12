# ADR 0001: Modular monolith on one origin

- Status: accepted
- Date: 2026-10-12

## Context

SyncSpace needs an HTTP API, real-time collaboration, durable storage and a web client. The specification asks for a MERN stack, JavaScript only, and no microservices without a demonstrated need.

## Decision

- **One Node.js process** serves the REST API (Express 5), the WebSocket collaboration endpoint (`ws`, same port) and, in production, the built web app. One origin means plain `SameSite=Lax` session cookies work for both HTTP and WebSockets, with no CORS configuration to get wrong.
- **npm workspaces** with clear module boundaries:

  | Package | Responsibility |
  |---|---|
  | `packages/shared` | Role/permission matrix, wire protocol encoding, limits, ply palette. Used by server enforcement *and* client UI, so the rules cannot drift. |
  | `packages/sync-client` | The offline-first sync engine (Yjs replica, IndexedDB storage, reconnect, durability tracking). Runs in browsers and in Node tests. |
  | `apps/server` | `auth/`, `workspaces/` (incl. the single authorization module `access.js`), `documents/`, `collab/`, `history/`, `activity/`, `diagnostics/`. |
  | `apps/web` | React + Vite + Tailwind UI. |

- **MongoDB via Mongoose** for users, sessions, workspaces, memberships, invitations, document metadata, the collaborative update log, checkpoints, versions and activity.

## Consequences

- Real-time state (open rooms, presence, connection registry) is in process memory. **The server runs as a single instance.** Horizontal scaling would need sticky routing per document or a shared pub/sub layer; this is documented as a limitation rather than built speculatively.
- The sync engine is tested end-to-end in Node against the real server, which is the main reason it is a separate package.
