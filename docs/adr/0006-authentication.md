# ADR 0006: Server-managed sessions and CSRF defence

- Status: accepted
- Date: 2026-10-12

## Decision

- **Passwords**: Argon2id via `@node-rs/argon2` (prebuilt binaries, no compiler needed) with OWASP's minimum parameters (m = 19 MiB, t = 2, p = 1). Unknown-email logins spend the same hashing work, so timing does not reveal which emails exist. Minimum length is 10 characters, with no composition rules (NIST SP 800-63B).
- **Sessions**: opaque 256-bit random tokens in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` and `__Host-` prefixed in production). Only a SHA-256 hash is stored, so a database leak does not yield usable sessions. Sessions have an absolute lifetime (default 7 days, TTL-indexed) and an idle timeout (default 3 days). Each sign-in creates a fresh session and ends the previous one (no fixation). Logout deletes the session and closes its WebSockets.
- **WebSockets** authenticate with the same cookie during the handshake. Every connection is re-validated each minute (session still live, membership still present, role changes applied), and closed immediately on logout, removal, or document deletion.
- **CSRF**, layered:
  1. `SameSite=Lax` cookies;
  2. state-changing requests must send `X-SyncSpace-Request: 1`, which cross-site forms cannot set and cross-site `fetch` cannot set without a CORS preflight the server never approves;
  3. a present `Origin` header must be an allowed origin, and `Sec-Fetch-Site: cross-site` is refused;
  4. WebSocket handshakes from non-allowed origins get 403 (cross-site WebSocket hijacking).
- **Rate limits**: sign-in (10 per 15 minutes per IP and account) and registration (20 per hour per IP), in memory, matching the single-instance design.
- **Authorization** lives in one module (`workspaces/access.js`) used by every HTTP route and the WebSocket upgrade. Non-members get **404**, not 403, so identifiers cannot be probed.

## Why not JWTs

Revocation (logout, removal from a workspace) must take effect immediately on open sockets. Server-side sessions make that a single delete; stateless tokens would need a denylist anyway.
