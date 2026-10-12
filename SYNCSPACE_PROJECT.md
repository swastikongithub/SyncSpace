# SyncSpace — Project Specification

> **Document purpose:** This file is the product and engineering source of truth for SyncSpace. A separate initialization prompt will tell Claude Code when and how to begin execution. This specification does not, by itself, authorize an unreviewed one-shot implementation.

## 1. Product Overview

**SyncSpace** is an original, browser-based collaborative workspace centered on shared documents that multiple people can edit together, including when one or more collaborators temporarily lose internet access.

The product's core promise is:

> People can work on the same document at the same time, keep working when connectivity disappears, and trust that their changes will converge and persist when connectivity returns.

SyncSpace should be a complete, usable product rather than a CRUD demonstration. The primary engineering challenge is the correctness and clarity of real-time collaboration, persistence, offline editing, reconnection, and access control.

### Intended users

- Individuals organizing notes and documents.
- Small teams or study groups collaborating on shared material.
- People who need to continue editing through unreliable network connections.

### Product principles

1. **Trustworthy editing:** users should not silently lose confirmed work.
2. **Collaboration as a first-class capability:** presence, shared edits, and collaboration state must be functional, not decorative.
3. **Offline resilience:** editing should remain useful while disconnected, within clearly communicated limits.
4. **Privacy and permissions:** a user must not be able to read or change documents they are not authorized to access.
5. **Original design:** SyncSpace must develop its own product identity and interaction model.
6. **Finish what is promised:** a smaller, correct, deployed product is better than a broad collection of unfinished features.

## 2. Non-Negotiable Constraints

### JavaScript only — TypeScript is prohibited

All project-owned application code and configuration must use JavaScript.

- Allowed application source formats: `.js` and `.jsx`.
- Do **not** create `.ts`, `.tsx`, `.mts`, or `.cts` project source files.
- Do **not** introduce TypeScript-based configuration files, declaration files, or a TypeScript compilation step.
- Use JavaScript-compatible tooling and configuration formats.
- Do not migrate to TypeScript, suggest TypeScript as an improvement, or silently introduce it through scaffolding.
- Third-party packages may internally be authored in TypeScript; the prohibition applies to SyncSpace's own source, configuration, and build workflow.

### Visual design must be independently conceived

The user does not want to provide UI references. Claude Code is expected to independently conceive and execute an original interface that fits SyncSpace's real workflows.

- Do not request or rely on screenshots, inspiration images, reference websites, UI kits, cloned templates, or a user-specified visual style.
- Do not imitate an existing product's interface or simply reskin a familiar collaboration app.
- Do not pre-commit to a palette, typography system, page layout, animation style, or visual metaphor before considering the product's needs.
- Explore the product's identity, interaction model, information hierarchy, and visual language from first principles.
- Make deliberate, coherent design decisions and be prepared to explain how they improve usability and reinforce SyncSpace's identity.
- Originality must not reduce readability, accessibility, responsiveness, discoverability, or editing efficiency.
- Avoid generic dashboard patterns and decorative effects that do not serve a user task.
- The final interface should feel intentionally designed across the full product: onboarding, workspace, document editing, collaboration, offline states, errors, empty states, and mobile layouts.

### Creative technology preferences: Three.js, React Three Fiber, WebGPU, and Spline

These technologies are part of the design exploration toolkit for SyncSpace. Claude Code should independently decide whether and where they can create a genuinely distinctive product experience. They are preferences to investigate, not a requirement to force every library into the final application.

- **Three.js:** Consider it for bespoke 3D scenes, spatial interactions, visual explanations, and purposeful interactive details that strengthen SyncSpace's identity.
- **React Three Fiber:** Prefer it as the React-native way to build and manage any custom Three.js scene when a 3D experience is justified. Keep scene components, lifecycle, state, and resource cleanup disciplined.
- **WebGPU:** Evaluate it for rendering where it provides a meaningful benefit. Check real browser/device support at implementation time, feature-detect it, and provide a graceful fallback—such as a supported Three.js WebGL renderer or a simpler DOM/canvas experience—rather than making core product access depend on WebGPU availability.
- **Spline:** Consider it for exploring or authoring original interactive 3D scenes and for embedding/exporting a scene when it fits the selected design. Do not use a stock Spline scene or copy an existing template as a substitute for original product thinking. Check bundle/runtime impact, hosting and network dependencies, mobile behavior, and the fallback state before adopting an embed.
- **Purpose before spectacle:** Any 3D element must support a real product purpose—orientation, workspace identity, explaining collaboration or synchronization, or a meaningful interaction. Do not add a decorative 3D hero, spinning object, or animated background just to advertise use of these tools.
- **Protect the editor:** 3D experiences must never interfere with typing, text selection, document readability, keyboard navigation, cursor presence, or the reliability of offline editing and synchronization. The core workspace must remain usable if a 3D scene fails to load or is disabled.
- **Performance and accessibility:** Lazy-load nonessential 3D scenes, clean up GPU resources, avoid needless render loops, respect reduced-motion preferences, provide appropriate keyboard and screen-reader alternatives, and adapt to small screens and lower-powered devices. Do not block the primary editing workflow while a scene loads.
- **Independent creative process:** Do not give Claude references, screenshots, example sites, predefined palettes, prescribed layouts, or a predetermined 3D concept. Ask it to derive the design from SyncSpace's purpose and workflows, compare reasonable approaches, and explain the product value and implementation cost of its chosen direction before building it.
- **JavaScript-only constraint still applies:** All project-owned integration and configuration code for these tools must remain JavaScript/JSX. Do not introduce TypeScript examples, `.ts`/`.tsx` files, or TypeScript-based configuration while integrating them.

During architecture/design discovery, Claude Code should explicitly assess Three.js, React Three Fiber, WebGPU, and Spline and record which are useful, which are not, and why. The finished product does not need to use all four; forced usage that harms usability, performance, or scope is a design failure.

### Scope boundaries

- Start as a **web application**. Native Android development is not part of the initial release.
- A Progressive Web App (PWA) may be considered after the web product and offline workflow are stable; it is not a substitute for correct offline synchronization.
- Do not add AI features, payments, microservices, Kafka, Kubernetes, or other infrastructure without a demonstrated product or engineering need.
- Do not build a custom CRDT algorithm for the MVP. Use a proven implementation and test its behavior in SyncSpace.

## 3. Required Technology Direction

Use the MERN stack with supporting real-time and offline libraries:

| Area | Direction |
|---|---|
| Frontend | React, JavaScript/JSX, Vite |
| Styling | Tailwind CSS is preferred; keep design tokens and reusable primitives organized |
| 3D / interactive graphics | Evaluate Three.js and React Three Fiber for original React-integrated 3D experiences where justified |
| Rendering capability | Evaluate WebGPU with feature detection and a tested fallback; do not make core editing depend on WebGPU |
| 3D authoring / embedding | Consider Spline if it serves the independently conceived design and meets performance, accessibility, and dependency requirements |
| Backend | Node.js and Express.js, JavaScript only |
| Database | MongoDB with Mongoose |
| Collaborative data model | Yjs CRDTs for conflict-free collaborative editing |
| Real-time transport | WebSockets, using an appropriate Yjs-compatible provider/server approach |
| Offline persistence | IndexedDB, using a compatible Yjs persistence integration |
| Authentication | Secure server-managed sessions or an equally well-justified secure approach; use HTTP-only, Secure-in-production cookies and appropriate CSRF protections where applicable |
| Automated tests | Vitest or an equivalent JavaScript test runner, Supertest for HTTP/API tests, Playwright for browser end-to-end tests |
| Local environment | npm scripts and Docker Compose where useful, including a local MongoDB service |
| CI | GitHub Actions or an equivalent CI workflow |

The exact library choices, persistence design, folder layout, and deployment provider should be finalized during architecture planning. Prefer mature, compatible libraries over custom infrastructure. Document important decisions and trade-offs before committing to them.

## 4. Product Capabilities

### 4.1 Accounts and authentication

- Registration, login, logout, and session expiration.
- Passwords must be securely hashed; never store plaintext credentials.
- Server-side validation and consistent error responses.
- Sensible loading, error, empty, and expired-session states in the UI.
- Users must not be able to impersonate other users or bypass authorization by manipulating client state.

Password reset and email verification may be added if they are feasible within the planned release, but they must not block delivery of the core collaboration workflow unless required by the final authentication design.

### 4.2 Workspaces and membership

- Users can create and access workspaces.
- Workspaces contain documents.
- Workspace owners/admins can manage membership and invitations.
- Invited members can join only through a valid, appropriately scoped invitation flow.
- Support a small, clear role model, such as owner/admin, editor, and viewer.
- Authorization must be enforced on the server for every protected request and every WebSocket document connection. Client-side hiding of buttons is not authorization.
- Users must not access another workspace's documents by guessing or substituting document IDs.

### 4.3 Documents and editing

- Create, rename, open, organize, and delete documents, with appropriate permission checks and safe deletion behavior.
- Provide a high-quality document editing experience with useful rich-text capabilities.
- Automatically persist edits without forcing users to click a save button after every change.
- Clearly distinguish locally saved changes from changes that have reached the server and from changes synchronized with collaborators.
- Preserve document content across browser reloads and later sessions.
- Support an initial set of practical formatting features rather than an oversized toolbar. Additional editor features must not undermine synchronization correctness.

### 4.4 Real-time collaboration

- Multiple authorized users can open and edit the same document simultaneously.
- Concurrent edits must merge through Yjs/CRDT behavior rather than naïve last-write-wins overwrites.
- Show useful live presence, such as collaborator identities and active editing state. Cursor or selection presence may be included if it is stable and accessible.
- Keep ephemeral presence separate from durable document content.
- Reconnecting clients must catch up with current document state without duplicating or discarding changes.
- WebSocket joins, updates, and awareness messages must respect authorization and validation rules.
- Server persistence must be designed so that process restarts do not destroy durable document content.

### 4.5 Offline editing and synchronization

This is a core capability, not a stretch feature.

- Persist local document state and pending updates in IndexedDB.
- When the network is unavailable, allow users to continue editing documents that are available locally.
- Communicate offline state clearly without unnecessarily blocking local editing.
- When connectivity returns, reconcile local and remote state using the CRDT rather than overwriting one side with the other.
- Handle repeated reconnects, delayed messages, duplicate updates, and interrupted synchronization safely.
- Provide honest synchronization status. Never claim that a change is server-persisted or synchronized until the application has evidence that it is.
- Define and document behavior for first-time access while offline, sign-out while pending updates exist, and switching accounts on a shared browser.
- Do not imply that every document is available offline unless it has actually been cached locally.

### 4.6 Version history

- Preserve a practical history of document states or snapshots.
- Allow authorized users to inspect prior versions and restore a prior state through a safe, auditable operation.
- Define snapshot frequency, retention, restoration, and persistence behavior based on measured and tested requirements.
- Do not treat transient cursor or presence updates as document revisions.

Version history is a planned core enhancement, but it must be added only after the persistence and synchronization model is stable.

### 4.7 Search and activity

- Provide basic document discovery within the user's authorized workspaces.
- A concise activity stream may record meaningful actions, such as document creation, invitations, edits or restorations, where those events add genuine value.
- Avoid building a social feed or notifications system unrelated to document collaboration.

## 5. Architecture and Data Integrity Expectations

### Architecture principles

- Prefer a modular monolith with clear frontend, API, authentication, workspace, document, and collaboration boundaries.
- Keep real-time transport and durable persistence responsibilities explicit.
- Separate workspace/document metadata, membership, durable collaborative updates or snapshots, and ephemeral presence appropriately.
- Avoid storing an unlimited history of binary updates in one growing MongoDB document. Consider append-only update records, periodic snapshots, and tested compaction/retention if supported by the chosen persistence design.
- Design for graceful reconnect and server restart behavior.
- Validate all inputs and enforce authorization at trusted server boundaries.
- Keep environment-specific secrets out of source control. Provide an `.env.example` containing names and safe placeholders only.
- Include clear scripts for setup, development, testing, linting if configured, and production builds.

### Security baseline

- Hash passwords with a modern password hashing library.
- Use secure cookies and session configuration appropriate to the deployment.
- Protect against cross-site request forgery where cookie-based authentication requires it; configure CORS narrowly.
- Validate request payloads, identifiers, invitations, and document operations.
- Rate-limit sensitive or abuse-prone endpoints where appropriate.
- Enforce document-level authorization in HTTP APIs and real-time channels.
- Do not log passwords, session secrets, access tokens, or document contents unnecessarily.
- Handle HTML/rich-text rendering safely to avoid stored cross-site scripting.
- Test unauthorized access and cross-workspace data leakage explicitly.

## 6. Quality Attributes

### Reliability

- Durable content survives refreshes, reconnects, and server restarts.
- Simultaneous editing converges to equivalent document state across clients.
- Offline changes remain available locally and are reconciled when connectivity returns.
- Persistence failure, session expiry, disconnect, and reconnect states are handled explicitly.

### Performance

- Keep ordinary navigation and editing responsive.
- Measure synchronization latency and behavior with multiple concurrent clients.
- Track useful signals such as active connections, update rates, synchronization latency, persistence errors, and reconnect failures when practical.
- Do not claim performance figures until they have been measured using a documented method.

### Accessibility and responsive behavior

- Support keyboard operation for primary navigation and editor actions where the editor library permits it.
- Maintain readable text, clear focus states, sensible semantic structure, and sufficient contrast.
- Design and test for desktop, tablet, and mobile browser sizes.
- Do not reduce the mobile view to a scaled-down desktop screenshot; prioritize its real tasks and constraints.
- Any Three.js / React Three Fiber / WebGPU / Spline experience must be treated as progressive enhancement: the app's principal workspace, document editor, and collaboration controls must remain functional when unsupported, slow, blocked, or disabled.
- Measure the impact of 3D assets and rendering on initial load, editor responsiveness, memory, and lower-powered devices. Keep nonessential scenes lazy-loaded and avoid continuous rendering when the scene is static.

### Maintainability

- Use consistent naming, small focused modules, and clear responsibility boundaries.
- Avoid giant components, duplicated authorization logic, hidden global state, and fragile implicit behavior.
- Keep comments useful and sparse; explain non-obvious decisions rather than restating code.
- Include an architecture overview, setup steps, test instructions, trade-offs, known limitations, and actual measurement results in the README.
- Use meaningful commits and do not collapse the entire project into one opaque code dump.

## 7. Testing Requirements

Automated tests must cover behavior, not just implementation details.

### Unit and integration tests

- Authentication and session lifecycle.
- Workspace membership and role permissions.
- Unauthorized document reads, writes, restores, and WebSocket joins.
- Document creation and metadata validation.
- Durable Yjs update persistence and reloading from stored state.
- Reconnection and duplicate/replayed update handling.
- Snapshot creation and restoration when version history is implemented.

### Collaboration correctness tests

- Two or more clients edit the same document concurrently and converge.
- Concurrent insertions/deletions do not silently overwrite one another.
- Randomized sequences of edits and message delivery orders converge to equivalent final document states.
- A client disconnects, edits offline, reconnects, and preserves its updates while incorporating remote changes.
- Server restart and reconnection do not lose previously persisted content.
- Unauthorized clients cannot subscribe to, read, or modify protected documents.

### Browser end-to-end tests

At minimum, exercise the primary workflow: register/login, create a workspace, create a document, invite or join another authorized user, edit collaboratively in separate browser contexts, disconnect one context, continue editing, reconnect, and verify convergence and persistence.

Use browser tooling or network controls to simulate offline and degraded connectivity. Avoid relying only on manually observed success.

### CI and release gates

- A clean checkout can install dependencies using documented commands.
- CI runs relevant unit, integration, and end-to-end tests.
- Production build succeeds.
- No project-owned TypeScript files or TypeScript build step are introduced.
- No secrets are committed.
- The release README and demo setup are accurate.

## 8. Milestones and Order of Work

Implement and verify incrementally. Do not attempt to build all features in one giant pass.

### Milestone 1 — Discovery and architecture

- Inspect the actual repository and environment before changing anything.
- Identify existing code, constraints, available services, and deployment options.
- Propose the application architecture, core data model, project structure, library choices, authentication design, and collaborative persistence strategy.
- Explore the design independently without supplied UI references. Assess Three.js, React Three Fiber, WebGPU, and Spline for potential product value; note compatibility, accessibility, performance, and maintenance trade-offs. Do not commit to using a tool merely because it is named in this specification.
- Record significant decisions and risks. Ask only when a true blocker or consequential ambiguity cannot be resolved responsibly.

### Milestone 2 — Foundation

- Establish a reproducible JavaScript-only monorepo or repository structure.
- Configure React/Vite, Express, MongoDB, environment handling, and local development scripts.
- Add baseline tests, error handling, and documentation.

### Milestone 3 — Authentication and workspaces

- Implement authentication, workspaces, membership, invitations, roles, and server-side authorization.
- Add tests for permission boundaries before document collaboration is exposed.

### Milestone 4 — Document experience

- Create the original design system and interface from first principles.
- Implement document management, editor integration, local persistence, metadata, loading/error/empty states, and responsive behavior.
- Validate usability before adding real-time features.

### Milestone 5 — Collaborative editing and server persistence

- Integrate Yjs with a compatible real-time transport and server-side authorization.
- Persist updates durably and rebuild a document from storage.
- Test concurrent edits, process restarts, and reconnects.

### Milestone 6 — Offline-first behavior

- Add IndexedDB persistence and offline availability indicators.
- Implement reconnect synchronization and tests for concurrent local/remote edits.
- Resolve edge cases before broadening feature scope.

### Milestone 7 — Version history, search, and polish

- Implement version history and restoration if the core sync model is reliable.
- Add useful search and activity capabilities.
- Refine accessibility, responsive design, loading states, and failure recovery.

### Milestone 8 — Production release

- Containerize the app and required services as appropriate.
- Add CI, deployment, environment documentation, demo data/accounts, monitoring or diagnostics, and a concise demo walkthrough.
- Run and document concurrency/reconnection tests and measured synchronization performance.
- Publish a clear list of limitations and follow-up work.

## 9. Definition of Done

SyncSpace is ready for its first meaningful public release when all of the following are true:

- A user can sign in, create a workspace, manage membership, and create a document.
- Two or more authorized users can edit the same document concurrently.
- Collaborative edits converge reliably across clients.
- Durable document content survives reloads and server restarts.
- A user can continue editing a locally available document while offline.
- Offline edits are reconciled with remote edits after reconnection without silent data loss.
- Permissions are enforced in both API and WebSocket paths and tested against cross-workspace access.
- The original UI is coherent, responsive, accessible, and complete across primary and failure states.
- Automated tests and the production build pass in CI.
- A live demo or clear reproducible local demo is available, and README claims are supported by evidence.
- Any performance numbers in the README or CV come from recorded measurements, not estimates or invented results.
- The repository remains JavaScript-only for project-owned code and configuration.

## 10. Explicitly Out of Scope for the Initial Release

- Native Android/iOS applications.
- A custom CRDT implementation.
- Microservices, Kafka, Kubernetes, and multi-region infrastructure without a concrete need.
- Payments, subscription billing, and monetization features.
- AI writing assistants or generic chatbot integrations.
- Enterprise SSO, complex compliance certifications, and large-scale administrative suites.
- Features that look impressive in screenshots but do not improve a core user workflow.

## 11. Portfolio and Documentation Expectations

SyncSpace should provide visible, verifiable evidence of engineering ability:

- A live, usable demo with sensible seeded data and safe demo access.
- A README explaining the problem, key workflows, architecture, local setup, environment variables, tests, deployment, and known limitations.
- Architecture diagrams only where they improve understanding.
- Decision records explaining meaningful trade-offs, especially CRDT collaboration, persistence, offline synchronization, access control, and snapshot strategy.
- Test evidence for simultaneous editing, offline edits, reconnect recovery, persistence, and authorization.
- Measured results with a brief explanation of how each measurement was gathered.
- A short demo walkthrough that shows the product working, including at least one real collaboration/offline scenario.

Do not invent user counts, accuracy claims, latency, throughput, test totals, or production usage. If actual users or performance measurements are not available, state that plainly and demonstrate the behavior using controlled tests.

## 12. Source and Rationale

The project concept is informed by the user's shared **India Tech Market Research — 2026** report, which identifies a real-time collaborative editor with CRDT-based editing and offline support as a potentially strong portfolio project. The report highlights convergence, presence, snapshot compaction, reconnect behavior, randomized concurrent-edit testing, measured synchronization latency, authenticated document access, and documented CRDT-versus-OT trade-offs.

This specification adapts that project concept to the user's firm requirement to use JavaScript rather than TypeScript and to give Claude Code independent responsibility for SyncSpace's original visual and interaction design.
