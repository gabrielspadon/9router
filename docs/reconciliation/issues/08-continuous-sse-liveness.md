# Continuous SSE liveness

Priority: P1
Status: Implemented — see correction below.

## Current behavior

Superseded: the `chunkCount === 0` gate described below is gone. `streamHandler.js` now re-arms a self-rescheduling `setTimeout` (`armKeepalive`, around line 517) after every downstream write, so a ping fires during any silent interval, before or after the first chunk. `tests/unit/sse-keepalive.test.js:72`'s describe title now reads `"SSE keepalive (post-transform, every silent interval)"`, and its test at `:82` asserts pings "before AND after the first chunk" — the exact opposite of the paragraphs below, which describe the pre-implementation state for context.

- `open-sse/utils/streamHandler.js:598-601` gates the downstream keepalive: `if (keepaliveMs > 0) { keepaliveTimer = setInterval(() => { if (chunkCount === 0 && streamController.isConnected()) { ...ping... } }, ...) }`. The `chunkCount === 0` guard means the ping fires only while zero upstream chunks have arrived — heartbeats stop the instant the first real chunk lands, by design.
- `tests/unit/sse-keepalive.test.js:72` is the `describe` block title itself: `describe("SSE keepalive (post-transform, pre-first-chunk only)", () => {`, and its one test (`:77`, `"emits pings post-transform while chunkCount is 0, stops at first chunk; translator input never sees a ping"`) asserts exactly that current, narrower behavior — heartbeats are required to stop after first data, which is the opposite of what continuous liveness needs.
- This is the actual gap for this row: the pre-first-chunk half already works correctly (a genuinely silent upstream before any data gets heartbeats today); the mid-stream half — keeping the client connection alive during a silent gap *after* the stream has already produced some output — does not exist, and the current test suite actively pins the old behavior as correct.

## Required behavior

Keep downstream heartbeats active during *every* silent interval, not only the one before the first chunk — a provider that emits one token, then goes quiet for tens of seconds before its next token, must still receive keepalive pings so the client connection is not torn down by an idle-timeout proxy in between. Upstream stall detection stays independent of the heartbeat mechanism: a heartbeat is downstream housekeeping and must never be read as upstream progress by the stall-detection clock, and it must never enter the translator's input stream (the existing pre-first-chunk test's "translator input never sees a ping" assertion is a real invariant that survives this change unchanged).

Failure direction: if the keepalive timer or the stall-detection timer cannot be established (config error, event-loop scheduling failure surfaced as a thrown error from `setInterval`'s callback), the stream fails closed to the existing TTFT-watchdog/stall-timeout behavior rather than silently running with no liveness signal at all — a broken keepalive must degrade to "the existing stall timeout eventually fires," not to an indefinitely silent, un-torn-down connection.

## Acceptance test

Required proof (Acceptance Tests, "Mid-stream silence"): "Heartbeats continue after real data, never enter the translator, and never reset the upstream stall timer. No duplicate failover occurs after committed output."

Vitest translation:

- Fixture: reuse `tests/unit/sse-keepalive.test.js`'s harness (`pipeWithDisconnect`, `createStreamController` from `open-sse/utils/streamHandler.js`) and its `spyTransform`/passthrough helpers so the translator-input spy assertion is exercised the same way.
- Fake clock: `vi.useFakeTimers()`. Sequence: emit one real upstream chunk (`chunkCount` becomes 1), advance the fake clock past the keepalive interval without emitting another chunk, assert a ping event reaches the downstream output — the direct regression check against the current `chunkCount === 0` gate.
- Assert the translator-input spy array contains zero ping frames across the whole sequence (the pre-existing invariant, still required).
- Assert the upstream stall-detection timer's deadline, read via its own tracked state/spy, is unchanged by the ping — advance the clock to just before the stall deadline, confirm no stall/failover fires from the ping alone, then let real upstream silence run past the deadline and confirm the stall path *does* fire on the real timeout, proving the two clocks are independent.
- Assert no duplicate failover: after the first real chunk is committed downstream, force a late upstream stall and confirm exactly one failover/error event is emitted, not one from a ping misfire plus one from the real stall.
- This also retires `tests/unit/sse-keepalive.test.js:77`'s "stops at first chunk" assertion — replace it in place rather than leaving a passing test that asserts the old, now-wrong behavior.
- Proposed file: `tests/unit/reconciliation/continuous-sse-liveness.test.js`.

## Blast radius

- `open-sse/utils/streamHandler.js` — the `:598-601` gate changes from `chunkCount === 0` to a "time since last chunk or last ping" check.
- `tests/unit/sse-keepalive.test.js` — its title and sole assertion (`:72`, `:77`) describe the behavior this row replaces; update in the same change rather than leaving a green test that locks in the old contract.
- `tests/unit/reconciliation/continuous-sse-liveness.test.js` — new.

No DB migration. Streaming liveness is in-request, in-memory state; nothing here is persisted.
