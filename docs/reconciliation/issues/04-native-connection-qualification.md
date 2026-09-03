# Native connection qualification

Priority: P0
Status: Implemented — `src/app/api/admin/{qualification,drain,activation,rollback}` routes live, plus `qualification/[connectionId]/recheck`. See correction below.

## Current behavior

- The matrix's own evidence for this row is that qualification, generation evidence, activation, and drain truth "remain in `ai-dotfiles/services/<legacy>/`" — outside this repository, so there is no TokenProxy `file:line` to re-verify for the missing capability itself. What is verifiable here is the admin surface it would extend.
- `src/proxy.js:2` imports `{ proxy as dashboardProxy } from "./dashboardGuard"`, wiring every request through the guard before any handler runs.
- `src/dashboardGuard.js:46` declares `PUBLIC_PREFIXES = ["/v1", "/v1beta", "/api/v1", "/api/v1beta", "/codex"]` — the structural-facts note in the task prompt cites this at `:73`; the live file has it at `:46`, a drift beyond the two the task named. `canAccessPublicLlmApi` (confirmed at `:164`) is the function that decides whether an inference key may reach one of those prefixes.
- Everything else under `/api/*` is deny-by-default: `src/dashboardGuard.js:269-270` (`// Deny-by-default for /api/*` / `if (pathname.startsWith("/api/")) {`) falls through to requiring a valid CLI token or an authenticated session (`:286-288`), returning 401 otherwise. This range matches the structural fact's `:269-289` closely.
- No qualification, activation, drain, or rollback endpoint exists under `/api/*` today for this guard to protect — there is nothing yet for it to extend. **This is now false**: `src/app/api/admin/qualification/route.js`, `.../drain/route.js`, `.../activation/route.js`, and `.../rollback/route.js` all exist, backed by `src/lib/admin/{qualification,state}.js`. The guard shape differs from what "Required behavior" below predicted: rather than extending `PROTECTED_API_PATHS`, `dashboardGuard.js:66` gives `/api/admin` its own `ADMIN_API_PREFIX` gate (`adminGateDenial`/`requireAdmin` in `src/lib/admin/guard.js`, sharing `adminDecision`/`adminAuthClass` from `src/lib/admin/policy.js`) — deliberately never added to `PUBLIC_PREFIXES` or leniency-eligible `PROTECTED_API_PATHS`, and state-changing calls take the `ALWAYS_PROTECTED`-equivalent path regardless of `requireLogin`.

## Required behavior

Add a small TokenProxy admin surface exposing, at minimum, connection qualification (a credential-safe check that a connection can reach its provider and produce a real generation), model catalog state, quota-window snapshots, drain, activation, rollback, and a per-generation receipt query. This surface is additive to `dashboardGuard.js`'s existing deny-by-default boundary, not a second authorization layer: new admin routes are added to `PROTECTED_API_PATHS` (or an equivalent list) so they inherit the same CLI-token-or-session requirement already enforced at `:269-289`, and any state-changing route among them additionally requires the scoped operator credential from Phase 0 (distinct from an inference key) rather than falling back to `requireLogin=false` dashboard-read leniency.

Failure direction: a qualification check that cannot reach the provider (timeout, network error, malformed provider response) reports the connection as *not qualified* with the failure reason attached — it never reports "qualified" on missing evidence, and it never throws past the admin handler in a way that would 500 the whole endpoint for one bad connection among many. A drain or rollback request against a connection ID that does not exist returns a 404-shaped admin error, not a silent no-op that a caller could mistake for success.

## Acceptance test

Required proof (Acceptance Tests, "Restart and drain"): "Existing streams finish during drain, new work stops entering the drained release, affinity survives restart, and rollback restores the prior healthy release."

Vitest translation:

- Fixture: a fake provider connection with an in-flight fake stream (a `ReadableStream` the test controls chunk-by-chunk) plus a second, queued request against the same connection.
- Call the new `drain(connectionId)` admin function while the first stream is mid-flight; assert (a) the in-flight stream is allowed to enqueue its remaining chunks and close normally (not aborted), (b) the queued second request is rejected or rerouted rather than admitted onto the draining connection, using row 02's reservation counter as the observation point.
- Restart simulation (same technique as row 03's affinity test — rebuild the in-memory layer from the persisted store only): assert a session pinned to a *different*, non-draining account is still pinned after the rebuild.
- Rollback: activate a second fake "release" record, then call `rollback()`; assert the qualification/admin query for "current release" returns the original release's identifier again.
- Proposed file: `tests/unit/reconciliation/native-connection-qualification.test.js`.

## Blast radius

- New admin route module(s) under `src/app/api/` (or wherever admin routes live today, mirroring `PROTECTED_API_PATHS` entries at `dashboardGuard.js:18-35`) for qualification, drain, activation, rollback, and generation receipts.
- `src/dashboardGuard.js` — extend `PROTECTED_API_PATHS` (or `ALWAYS_PROTECTED` for the state-changing subset) to cover the new routes; no change to the deny-by-default mechanism itself.
- New service module for qualification/drain/activation/rollback state transitions, called by both the admin routes and row 02/03's reservation and affinity layers (drain needs to see live reservations; rollback needs to see active affinity pins).
- `tests/unit/reconciliation/native-connection-qualification.test.js` — new.

DB migration: none — contrary to this doc's prediction. `src/lib/admin/state.js` stores release/activation/drain state as singleton documents in the existing `kv` table (via `makeKv`), not new `TABLES` entries: "nothing here is queried by anything but id... a table would buy an index no query uses" (`state.js:9-13`). `TABLES` (`schema.js:21`) is at 16 entries today, none of them a release/drain/receipt table.
