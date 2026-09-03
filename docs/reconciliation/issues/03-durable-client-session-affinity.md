# Durable client-session affinity

Priority: P0
Status: Implemented (commit 02afc6af, "feat: quota-window scheduling core") — see correction below.

## Current behavior

Superseded: a `sessionAffinity` table now exists (`schema.js:246`), backed by `src/lib/db/repos/sessionAffinityRepo.js` and wired into selection via `src/sse/services/schedulerRepos.js` and `resolveRoutingSessionHash`/`selectAndReserve` in `auth.js:483-491`. The pin/repin/switch-receipt behavior this row asked for is built. The paragraphs below describe the pre-implementation state for context; the one claim that still holds is that `open-sse/utils/sessionManager.js`'s `runtimeSessionStore` (confirmed unchanged, still lines 14-15) was correctly left alone rather than repurposed — the new affinity logic lives beside it, not inside it, exactly as this row's Blast Radius specified.

- `open-sse/utils/sessionManager.js:14` is a comment (`// Runtime storage: Key = connectionId, Value = { sessionId, lastUsed }`) directly above the actual store at line 15, `const runtimeSessionStore = new Map();`. The module docstring (`:5-6`) states the intent plainly: "generates a session ID at startup and keeps it for the process lifetime, scoped per account/connection" — an in-memory `Map` that is empty again on every restart, by design, for a different purpose (Antigravity Cloud Code prompt-cache continuity), not client-session-to-account affinity.
- `src/sse/handlers/chat.js:487-490` (`const pinnedConnectionId = comboChain ? resolveComboMemberConnection(...) : null;`) is the only pinning in the request path, and it only fires for combo chains or the same-request retry loop (`requestReplayConnectionId`, `:485`). A plain single-model request from the same client session has no pin at all — the matrix's cited `:486` lands on the explanatory comment one line above this block, which is accurate to the described behavior, not a drift.
- A grep for `affinity` across `src` and `open-sse` turns up exactly one hit, `open-sse/executors/mimo-free.js:124` (`"x-session-affinity": sessionId`), an outbound header for one provider's own load balancer — unrelated to TokenProxy owning session-to-account affinity.
- No table in `src/lib/db/schema.js` stores a client-session key. There is no restart-recovery path because there is nothing to recover. **This sentence is now false**: `sessionAffinity` (`schema.js:246-266`) stores exactly this, with `idx_sa_conn`/`idx_sa_expires` indexes for the repin and TTL-eviction paths.

## Required behavior

This is a scheduling row; it is bound by Account Scheduling Contract rules 4, 5, and 8.

- **Pin (rule 4).** Once an account is selected for a client session, pin the session to that account. Do not round-robin between healthy accounts for the same session. Keep the pin until: the account becomes unavailable, a higher-priority account's quota resets, the operator drains the pinned account, or a model-specific failure requires repin.
- **Repin (rule 5).** When the pinned account exhausts a binding window, move the session to the next eligible account (per row 01's ranking). If an earlier account later resets while a later one is active, atomically return the session to the earliest restored account — never spray one session across accounts to chase instantaneous throughput.
- **Persist the switch reason (rule 8)** without storing credentials or prompt bodies: old and new connection IDs, the normalized quota windows that triggered the switch, the trigger type, model, a session hash (never the raw session identifier or client content), and a timestamp.
- Persistence must survive a process restart (TTL-bounded, cache-aware stickiness) — this is the durability the row's name promises and today's `runtimeSessionStore` explicitly does not provide.

Failure direction: if the affinity record for a session is missing, expired past TTL, or references a connection that no longer exists, the session is treated as new — run the normal ranking-based selection (row 01) and create a fresh pin — never fail the request and never silently fall back to round-robin. A malformed or unparseable stored pin is discarded, not trusted.

## Acceptance test

Required proof (Acceptance Tests, "Affinity"): "One client session remains on one healthy account across turns and process restart. No round-robin switch occurs."

Vitest translation:

- Fixture: one fake client session hash, two healthy fake accounts with equal ranking under row 01's algorithm (so a broken implementation that falls back to round-robin would visibly alternate), a fake provider executor.
- Turn 1: call the selection path with the session hash; assert it resolves to account A and a pin record is persisted for that session hash.
- Turn 2 (same process): call again with the same session hash; assert it resolves to A again even though A and B rank identically — proves the pin overrides ranking, not just coincidence.
- Restart simulation: since this is a single Vitest process, "restart" is simulated by tearing down and re-constructing the in-memory selector/cache from only the persisted store (drop any process-local cache, reload from the DB-backed layer) and calling again with the same session hash — assert it still resolves to A.
- Negative control: a *different* session hash on the same two accounts is asserted to be free to land on either A or B (proving the fixture's equal ranking would otherwise alternate, so the pin is doing the work).
- Proposed file: `tests/unit/reconciliation/durable-client-session-affinity.test.js`.

## Blast radius

- New module (e.g. `src/sse/services/sessionAffinity.js`) implementing pin, repin-on-exhaustion, atomic return-to-earliest-restored, and switch-reason persistence.
- `src/sse/handlers/chat.js` — the `:487-490` pin lookup needs a session-affinity check ahead of (or instead of) the combo-only path, wired into the same selection call row 02 already touches.
- `open-sse/utils/sessionManager.js` stays as-is; it is process-cache continuity for a different provider concern (Antigravity), not the thing being replaced — do not repurpose it, add the new persistence alongside it.
- `tests/unit/reconciliation/durable-client-session-affinity.test.js` — new.

DB migration: done, as predicted. `sessionAffinity` and `accountSwitches` (the switch-reason log, feeding `src/shared/utils/switchReceipt.js`) are both live `TABLES` entries (`schema.js:21`, 16 entries today, not 13 or 14).
