# Account-scoped request admission

Priority: P0
Status: Implemented (commit 02afc6af, "feat: quota-window scheduling core") — see correction below.

## Current behavior

Superseded: `src/shared/utils/accountLease.js` (`createLeaseRegistry`) plus `src/sse/services/accountLeaseRegistry.js`/`accountScheduler.js` (`selectAndReserve`, called from `auth.js:485`) now provide exactly the atomic select-and-reserve, per-account capacity, and lifetime-spanning lease this row asked for — `releaseAccountLease`/`releaseAccountLeaseOnResponse` are wired into every handler (chat, tts, embeddings, search, videoGeneration, imageGeneration, rerank, fetch, stt, jsonProxy). The paragraphs below describe the pre-implementation state for context; the specific line numbers have also drifted (`getProviderCredentials` is now at `auth.js:230`, `providerSelectionQueues` declared `:49`, its `releaseQueue()` call at `:571`) since the file grew with the new scheduler imports.

- `src/sse/services/auth.js:123` `getProviderCredentials(...)` acquires a per-provider queue (`providerSelectionQueues`, declared `:34`) that serializes *selection* only: `await previousQueue` at the top of the function, then a `finally` block at line 371 that calls `releaseQueue()` at **line 372** and clears the map entry. The matrix evidence cites the release at line 371; the actual `releaseQueue()` call is one line later, at `:372` — a drift beyond the two the task called out. The queue's lock is held for the duration of picking a connection, not for the duration of the request that connection then serves; once `getProviderCredentials` returns, the "lease" is gone.
- `src/sse/handlers/chat.js:358-376` (`providerConcurrencyOverflow`) is a *provider-wide* cap read from `providerStrategies[<provider>].maxConcurrent`, compared against `getActiveRequests()` (`src/lib/db/repos/usageRepo.js:442`) grouped by provider. It has no per-account dimension and no reservation: the comparison `if (inFlight < limit) return null;` (`:375`) is a point-in-time read with no lock between the read and the caller proceeding.
- `src/sse/handlers/chat.js:460-464` is where a provider-wide overflow becomes a hard refusal — `const overflow = await providerConcurrencyOverflow(provider);` / `if (overflow) { ... return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, ...); }`. This is the real 503 site; the matrix's cited `:375` is the cap comparison inside the helper, not the refusal itself, confirming the task's first known drift.
- There is no queue, no cancellation path, and no per-account capacity anywhere between the moment a connection is chosen and the moment the stream finishes. Two concurrent requests that both pass the `:460` check can both proceed against the same account with no reservation counting either of them. **This paragraph is now false**: `effectiveCapacity` (`accountCapacity.js`, imported `auth.js:42`) supplies per-account capacity and `createLeaseRegistry` enforces it with a real reservation counter.

## Required behavior

This is a scheduling row; it is bound by Account Scheduling Contract rules 6-7.

- **One transaction (rule 6).** Selection and reservation happen together. Concurrent requests racing for the last available slot on an account must not all observe the same free slot and over-admit it — exactly one wins, the rest either queue or fail over to the next eligible account under rule 3's ranking.
- **Configurable capacity (rule 7).** Capacity is per-connection, not per-provider. A high-capacity account may run dozens of concurrent requests while another accepts only a few; the existing `providerStrategies[<provider>].maxConcurrent` cap survives as an optional outer ceiling, not the only gate.
- The reservation ("lease") spans the request's full lifetime — held from the atomic select-and-reserve through stream completion, terminal error, client disconnect, or abort — and is released exactly once regardless of which of those four paths ends the request.
- Requests that cannot be admitted immediately queue with FIFO fairness and honor caller cancellation (an aborted `callerSignal` while queued must dequeue the caller, not leave a phantom reservation).

Failure direction: when the reservation table or per-account capacity config is missing or unreadable for a connection, the request must fail closed to the *provider-wide* cap already in place (`providerConcurrencyOverflow`) rather than being admitted uncapped — the existing helper's fail-open behavior on a *missing setting* (`chat.js:363`, unreadable settings return `null`, meaning "no cap") is acceptable only for the outer ceiling; the per-account lease itself must never silently become a no-op cap.

## Acceptance test

Required proof (Acceptance Tests, "Atomic admission"): "Parallel selection at the final slot admits exactly one request. Every reservation is released on success, error, abort, and disconnect."

Vitest translation:

- Fixture: one fake account with capacity `1` (the "final slot" case) and a fake provider executor that resolves after a controllable delay (`vi.useFakeTimers` or a manually-resolved promise) so the test can hold two admissions in flight simultaneously.
- Fire `N = 10` concurrent calls into the reserve function with `Promise.allSettled`; assert exactly one resolves as admitted and the other nine either queue-then-admit-after-release or are rejected per the queue's fairness policy — never more than `capacity` reservations open at once, checked via a spy/counter incremented on reserve and decremented on release.
- Four release-path sub-cases, each starting from a fresh single-slot reservation: (1) normal completion calls the release exactly once; (2) a thrown provider error still releases (wrap in `try/finally` semantics, assert via the same counter); (3) `AbortController.abort()` on a queued caller removes it from the queue without ever incrementing the reservation counter; (4) a simulated disconnect (calling the cleanup callback directly) releases a held reservation. Assert the counter returns to `0` after each.
- Proposed file: `tests/unit/reconciliation/account-scoped-request-admission.test.js`.

## Blast radius

- `src/sse/services/auth.js` — `getProviderCredentials` needs to hand back a release handle tied to the request lifetime, not release at `:372` once selection finishes.
- `src/sse/handlers/chat.js` — the `:460-464` refusal site and its surrounding request lifecycle (stream completion, `callerSignal` abort handling already present around `chat.js:496`) need to call reserve/release instead of, or in addition to, `providerConcurrencyOverflow`.
- New module (e.g. `src/sse/services/accountReservation.js`) for the atomic select-and-reserve primitive and its queue.
- `tests/unit/reconciliation/account-scoped-request-admission.test.js` — new.

DB migration: as predicted, none — the lease registry landed in-process (`accountLease.js`'s `Map`-backed `createLeaseRegistry`), not as a durable table. `TABLES` (`schema.js:21`) has 16 entries today (not 13 or 14); the three added since this doc were written are `quotaWindows`, `sessionAffinity`, `accountSwitches` — none is a reservation ledger.
