# Retry and backpressure truth

Priority: P1
Status: Partial

## Current behavior

- Provider fallback across accounts already exists in `src/sse/services/auth.js` (the `fallbackStrategy` selection at `:272`, walking `routedConnections` on failure), so a single account's transient error already tries the next candidate.
- The gap is upstream of that fallback: `src/sse/handlers/chat.js:460-463` (`providerConcurrencyOverflow`) can return a 503 before any account has even been reserved — it is a provider-wide in-flight count check (`getActiveRequests()`, `src/lib/db/repos/usageRepo.js:442`) compared against `providerStrategies[<provider>].maxConcurrent`, with no queue behind it. A caller hitting this cap gets an immediate local refusal with no wait and no per-account distinction, and row 02 confirms there is no reservation-spanning-the-request-lifetime primitive that a queue could sit behind yet.
- The resilience overlay's 180-second admission wait and `Retry-After` behavior (`auth-proxy.mjs:1085`, `:3109`) lives in `ai-dotfiles`, outside this repository — there is no TokenProxy-side queue-with-timeout to re-verify against; the matrix's own Decision column already frames this as something to build here, not something to port byte-for-byte.
- No local admission refusal today carries a `Retry-After` header computed from queue state; `chat.js:463`'s `errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, ...)` is a bare 503.

## Required behavior

Queue locally instead of refusing immediately: a request that cannot be admitted right away (row 02's atomic select-and-reserve has no free slot on any eligible account) waits in a fair, cancellable queue rather than receiving an instant 503. Caller cancellation (an aborted `callerSignal`) dequeues cleanly. Only once a request genuinely cannot be admitted safely — the queue itself is at its own bound, or every eligible account is provably unavailable rather than merely busy — does the request receive a 429 or 503, and that response carries an accurate `Retry-After` computed from real queue/quota state (the soonest point at which capacity or a quota reset is expected), never a guessed constant.

Failure direction: a local admission refusal must never be translated into a false provider-capacity claim — the response and its `Retry-After` describe TokenProxy's own local queue/reservation state, not an assertion about whether the upstream provider itself has capacity, since those are different facts and conflating them is exactly what a caller doing its own backoff math would be misled by.

## Acceptance test

Required proof (Acceptance Tests, "Retry metadata"): "Queue timeout and retryable provider failures return the correct status and `Retry-After`. Authentication, payment, and policy failures are not retried."

Vitest translation:

- Fixture: one fake account at capacity (row 02's reservation primitive) with a configured queue timeout, plus a fake provider executor whose failure mode is parameterized per case (transient 5xx, 429, 401, 402, and a policy-rejection 4xx).
- Queue-timeout case: fill the account's capacity, enqueue one more request, advance a fake clock past the configured queue timeout, assert the response is a 429 or 503 (per the configured queue-full policy) carrying a `Retry-After` value that matches the timeout window used, not a hardcoded default.
- Retryable-failure case: the fake provider returns a transient 5xx on the first attempt and succeeds on the second; assert the request is retried against a fallback account (exercising the existing `:272` strategy) and the caller ultimately sees the successful response, not the transient error.
- Terminal-failure cases (401, 402, and one policy-rejection 4xx): assert each is returned to the caller immediately with its original status, with the fallback/retry path's spy asserting **zero** additional attempts — this is the "not retried" half of the proof and the part most likely to regress silently if retry logic gets generalized too broadly.
- Proposed file: `tests/unit/reconciliation/retry-and-backpressure-truth.test.js`.

## Blast radius

- `src/sse/handlers/chat.js` — the `:460-463` refusal site becomes queue-aware, built on row 02's reservation primitive rather than the bare provider-wide count check.
- `src/sse/services/auth.js` — the retry-classification logic (which statuses are transient vs. terminal) needs to be centralized if it is not already, so this row and row 02's queue share one classification rather than each hand-rolling its own.
- New or extended module for `Retry-After` computation from live queue/quota state.
- `tests/unit/reconciliation/retry-and-backpressure-truth.test.js` — new.

No DB migration. Queue state and retry classification are in-request/in-process; nothing new needs to persist beyond what rows 01-03 already add for reservations and quota windows.
