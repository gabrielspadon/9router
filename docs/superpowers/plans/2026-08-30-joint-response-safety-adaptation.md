# Joint Response-Safety Adaptation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make non-streaming upstream body consumption bounded and cancelable, keep account failure diagnostics model-scoped, and make incomplete supported client SSE streams explicit without changing healthy stream timing.

**Architecture:** Build the body deadline around the only real ReadableStream reader, retain model-lock expiry fields while attaching independent per-key metadata, and observe complete client-emitted SSE records after translation. The implementation starts only after PR3632 is in the selected base and maintains a legacy-compatible pipeWithDisconnect call form while new callers use an options object.

**Tech Stack:** Node.js ESM, WHATWG Streams and AbortSignal, Next.js route handlers, Vitest 4, existing SQLite JSON connection records, ESLint, repository no-regression verifier.

## Global Constraints

- Begin only from a canonical commit that contains PR3632 tip 0e453ed1d or its equivalent integrated descendant.
- Do not merge, cherry-pick, or mechanically port upstream PRs #3220, #3221, or #3222.
- Preserve PR3632 response-header timeout behavior. ConnectTimeoutError remains a 502.
- Response body timeout default is RESPONSE_BODY_TIMEOUT_MS = 300000. It is positive and cannot be disabled with zero or a negative value.
- Caller cancellation is only the original incoming Request.signal. It maps through a typed clientAborted result to 499, then short-circuits before request replay, markAccountUnavailable, account exclusion, or fallback. Never substitute streamController.signal for it.
- Map body timeout to 504 with one ordinary fallback transition, malformed body and unrelated reader failures to 502.
- Do not call Response.text(), Response.json(), or response.body.cancel() in a path that claims reader-owned cleanup.
- Keep modelLock_<key> expiry fields. Store metadata as independent top-level modelFailure_<key> fields, never a shared map.
- Select only the active __all lock or exact requested-model lock. __all takes precedence.
- Return 404 only from a provider-keyed, structured unknown-model predicate that proves the requested model. Generic prose is not proof.
- Keep raw upstream status for fallback. Project client status separately.
- Preserve legacy pipeWithDisconnect positional arguments in this exact order: onAbortTerminal, stallTimeoutMs, ttftTimeoutMs, keepaliveMs.
- Observe complete client-emitted SSE records after translation. Never scan content prose for terminal words and never synthesize a terminal for an unsupported format. A supported format that reaches EOF without a proven terminal emits exactly one typed terminal failure and takes the abandonment/error lifecycle, never handleComplete.
- Do not change dashboard settings, retry policy, OAuth refresh, arbitrary media/polling reads, production processes, tracking files, upstream state, or remote refs.
- Use explicit git-add paths, one conventional commit per task, no push. Force-add only the ignored plan and spec documentation artifacts.

---

## Locked File Map

| Path | Responsibility |
| --- | --- |
| open-sse/config/runtimeConfig.js | Validated RESPONSE_BODY_TIMEOUT_MS default. |
| open-sse/utils/bodyTimeout.js | Reader ownership, first-cause arbitration, typed timeout, decoding helpers. |
| open-sse/transformer/streamToJsonConverter.js | Optional externally owned reader for Responses SSE conversion. |
| open-sse/handlers/chatCore/nonStreamingHandler.js | Deadline-aware JSON, text SSE, and Responses conversions. |
| open-sse/handlers/chatCore/sseToJsonHandler.js | Deadline-aware forced Chat, Gemini, and Responses SSE conversions. |
| open-sse/handlers/responsesHandler.js | Caller-signal forwarding and deadline-aware non-streaming /v1/responses conversion. |
| open-sse/handlers/chatCore.js | Carry callerSignal independently from streamController.signal, preserve 499, 502, and 504 lifecycle, and retain parsed safe failure metadata. |
| open-sse/utils/error.js | Typed caller-abort result and parsed upstream error payload retained only long enough for safe status classification. |
| src/sse/handlers/chat.js | Original request.signal propagation through every credential/replay iteration, typed abort short-circuit, and selected allRateLimited client-status projection. |
| src/app/api/v1/responses/compact/route.js | Preserve the incoming signal while replaying its compacted Request body. |
| src/app/api/v1/{api/chat,chat/completions,messages,responses}/route.js | Public request signal pass-through verification only, no wrapper signal replacement. |
| open-sse/services/accountFallback.js | Exact and account-wide lock pair helpers. |
| open-sse/config/modelErrorClassifier.js | Provider-keyed structured unknown-model predicates and safe client-status projection. |
| src/sse/services/auth.js | Credential selection, one-ISO lock/metadata write, paired cleanup, selected metadata result. |
| src/sse/handlers/embeddings.js | Embeddings allRateLimited client-status projection. |
| src/sse/handlers/fetch.js | Fetch allRateLimited client-status projection. |
| src/sse/handlers/imageGeneration.js | Image allRateLimited client-status projection. |
| src/sse/handlers/jsonProxy.js | JSON proxy allRateLimited client-status projection. |
| src/sse/handlers/search.js | Search allRateLimited client-status projection. |
| src/sse/handlers/stt.js | STT allRateLimited client-status projection. |
| src/sse/handlers/tts.js | TTS allRateLimited client-status projection. |
| src/sse/handlers/videoGeneration.js | Video allRateLimited client-status projection. |
| open-sse/utils/streamTerminal.js | Bounded typed client-SSE terminal observer, including 64 KiB/128-data-line record limits and release state. |
| open-sse/utils/streamHandler.js | Options normalization, observer placement, one synthetic terminal and abnormal-lifecycle path. |
| open-sse/handlers/chatCore/streamingHandler.js | Client emitted-format reporting and named pipe options. |

Tasks own their listed edits. open-sse/utils/error.js and open-sse/handlers/chatCore.js are intentionally sequential Task 1 then Task 2 interfaces. Task 4 modifies no runtime file.

## Task 1: Reader-Owned Non-Streaming Body Deadline

**Files:**

- Create: `open-sse/utils/bodyTimeout.js`
- Create: `tests/unit/body-read-deadline.test.js`
- Create: `tests/unit/non-stream-body-timeout.test.js`
- Create: `tests/unit/caller-abort-propagation.test.js`
- Modify: `open-sse/config/runtimeConfig.js`
- Modify: `open-sse/utils/error.js`
- Modify: `open-sse/transformer/streamToJsonConverter.js`
- Modify: `open-sse/handlers/chatCore/nonStreamingHandler.js`
- Modify: `open-sse/handlers/chatCore/sseToJsonHandler.js`
- Modify: `open-sse/handlers/responsesHandler.js`
- Modify: `open-sse/handlers/chatCore.js`
- Modify: `src/sse/handlers/chat.js`
- Modify: `src/app/api/v1/responses/compact/route.js`
- Test: `tests/unit/stream-to-json-converter.test.js`
- Test: `tests/unit/responses-stream-to-json-usage.test.js`
- Test: `tests/unit/openai-responses-nonstream.test.js`
- Test: `tests/unit/pr3445-nonrouting.test.js`
- Test: `tests/unit/chat-connect-timeout-propagation.test.js`

**Interfaces:**

- Consumes: the original `request.signal` from `handleChat(request)`; that exact signal is passed as `callerSignal` through each `handleSingleModelChat` credential/replay iteration, `handleChatCore`, `handleResponsesCore`, and every non-stream reader. `streamController.signal` remains a distinct upstream/stream lifecycle signal and is never supplied as `callerSignal`.
- Produces: `BodyReadTimeoutError` with name `BodyReadTimeoutError`, code `UPSTREAM_RESPONSE_BODY_TIMEOUT`, and `timeoutMs`; `CallerAbortError` retaining the original signal reason; `isBodyReadTimeoutError(error)`; `isCallerAbortError(error)`; `consumeResponseBodyWithDeadline({ body, callerSignal, timeoutMs, consume })`; `readResponseTextWithDeadline(options)`; `readResponseJsonWithDeadline(options)`.
- Produces: `createCallerAbortResult()` as `{ success: false, clientAborted: true, status: 499, error: "Request aborted", response }`. The typed result is returned before replay, `markAccountUnavailable`, account exclusion, retry, or fallback.
- Produces: `convertResponsesStreamToJson(stream, { reader } = {})`, where a supplied reader is consumed but never released by the converter.
- Produces: non-stream consumers which return 499 only for `callerSignal`, 504 only for `BodyReadTimeoutError`, and 502 for malformed or unrelated reader errors. `ConnectTimeoutError` retains PR3632's existing 502 transport map.

- [ ] **Step 1: Establish public caller-signal and reader-owner red tests**

Create `tests/unit/caller-abort-propagation.test.js`. With an abortable incoming Request and spies on `handleChatCore`, `markAccountUnavailable`, and credential selection, cover all public handoffs: `/api/v1/chat/completions`, `/api/v1/messages`, `/api/v1/responses`, `/api/v1/api/chat`, and `/api/v1/responses/compact`. Assert each original `request.signal` reaches `handleChatCore`; the compact replayed Request retains it; a typed abort reaches 499 exactly once; and no replay or fallback work occurs. Exercise both the normal credential attempt and the request-buffer replay candidate path.

Create `tests/unit/body-read-deadline.test.js` with a controllable ReadableStream that records `getReader`, `read`, `cancel`, and `releaseLock`. Cover a UTF-8 split text body, valid JSON body, timer-first stall, caller-first abort, late EOF after timeout, and idempotent cleanup.

Run:

```bash
cd tests
npx vitest run unit/caller-abort-propagation.test.js unit/body-read-deadline.test.js
```

Expected: FAIL because `callerSignal` is neither threaded from the public request nor represented as `clientAborted`, and `bodyTimeout.js` plus its named exports do not exist.

- [ ] **Step 2: Implement the isolated reader owner and typed abort result**

Add `RESPONSE_BODY_TIMEOUT_MS` near `FETCH_CONNECT_TIMEOUT_MS` with default 300000 and the existing positive env parser. Add `bodyTimeout.js` and the typed abort/result helpers in `error.js`. The consumer receives the acquired reader, not the raw stream. Timer and only `callerSignal` listeners first set one terminal source, then cancel that reader for deadline or caller abort, and the owner releases the lock exactly once in its finalization path. Text decoding uses a streaming TextDecoder and JSON parsing occurs only after complete decoded text.

Do not use `Promise.race` around `Response.text()` or `Response.json()`. Do not offer an unbounded opt-out. No branch may inspect `streamController.signal` to classify caller cancellation.

Run:

```bash
cd tests
npx vitest run unit/caller-abort-propagation.test.js unit/body-read-deadline.test.js
```

Expected: PASS. The timer case proves `reader.cancel` receives `BodyReadTimeoutError`, caller abort preserves its original reason, no late success is returned, and the public-replay test observes no account mutation.

- [ ] **Step 3: Make the Responses converter ownership-compatible**

Modify `convertResponsesStreamToJson` to retain its current stream-only API and accept an optional reader. It must acquire and release a reader only in the stream-only form. When the body owner provides reader, the outer owner alone releases it.

Extend `tests/unit/stream-to-json-converter.test.js` and `tests/unit/responses-stream-to-json-usage.test.js` with an externally acquired reader fixture and its release counter.

Run:

```bash
cd tests
npx vitest run unit/stream-to-json-converter.test.js unit/responses-stream-to-json-usage.test.js
```

Expected: FAIL before the converter accepts the supplied reader, then PASS with existing direct-stream expectations unchanged.

- [ ] **Step 4: Write consumer-level red tests**

Create `tests/unit/non-stream-body-timeout.test.js`. Use fake timers and response streams to exercise ordinary non-streaming JSON, Chat-Completions forced SSE, Gemini forced SSE, forced Responses SSE, and `/v1/responses` forced SSE. For each path test healthy completion, body stall, malformed payload, and caller cancellation. Mock the outer credential loop once to assert a body 504 reaches exactly one ordinary `markAccountUnavailable` transition while a typed caller 499 reaches no mutation, replay, retry, or fallback.

Run:

```bash
cd tests
npx vitest run unit/non-stream-body-timeout.test.js
```

Expected: FAIL because callers still use convenience readers and no path distinguishes typed 499, 502, and 504.

- [ ] **Step 5: Integrate request, replay, and non-streaming consumers**

In `src/sse/handlers/chat.js`, pass the incoming `request.signal` as `callerSignal` on every `handleChatCore` call inside the account/replay loop. Immediately after an unsuccessful result, return `result.response` when `result.clientAborted` is true, before `isRequestReplayBufferError`, `markAccountUnavailable`, failure counts, account exclusion, or loop continuation. In `src/app/api/v1/responses/compact/route.js`, pass `signal: request.signal` to the constructed Request. The other listed public routes already pass their original Request unchanged and are protected by the Step 1 public-route tests.

Accept and forward `callerSignal` in `handleResponsesCore` and `handleChatCore`. Pass it only through non-stream shared contexts into `nonStreamingHandler`, `sseToJsonHandler`, and `responsesHandler`. Replace only their direct JSON, text, and Responses converter body reads with the Task 1 owner. Classify `CallerAbortError` to `createCallerAbortResult()`, then `BodyReadTimeoutError` to `GATEWAY_TIMEOUT` before malformed-payload handling. Keep `ConnectTimeoutError` on its existing `mapTransportError` 502 path.

Call `trackDone`, success callback, usage persistence, and `streamController.handleComplete` only after a successful body result. Let a 504 return as an ordinary failed upstream attempt so the outer credential loop owns exactly one fallback decision. Never route caller abort through `streamController.handleError` or a fallback path.

Run:

```bash
cd tests
npx vitest run unit/caller-abort-propagation.test.js unit/body-read-deadline.test.js unit/non-stream-body-timeout.test.js unit/stream-to-json-converter.test.js unit/responses-stream-to-json-usage.test.js unit/openai-responses-nonstream.test.js unit/pr3445-nonrouting.test.js unit/chat-connect-timeout-propagation.test.js
```

Expected: PASS.

- [ ] **Step 6: Run Task 1 static and scope gates**

Run:

```bash
npx eslint open-sse/config/runtimeConfig.js open-sse/utils/bodyTimeout.js open-sse/utils/error.js open-sse/transformer/streamToJsonConverter.js open-sse/handlers/chatCore/nonStreamingHandler.js open-sse/handlers/chatCore/sseToJsonHandler.js open-sse/handlers/responsesHandler.js open-sse/handlers/chatCore.js src/sse/handlers/chat.js src/app/api/v1/responses/compact/route.js tests/unit/body-read-deadline.test.js tests/unit/non-stream-body-timeout.test.js tests/unit/caller-abort-propagation.test.js
git diff --check
git diff --name-only
```

Expected: ESLint exits 0, diff check has no output, and changed runtime paths equal Task 1's file list. The public routes other than `responses/compact` remain test-only verification paths.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add open-sse/config/runtimeConfig.js open-sse/utils/bodyTimeout.js open-sse/utils/error.js open-sse/transformer/streamToJsonConverter.js open-sse/handlers/chatCore/nonStreamingHandler.js open-sse/handlers/chatCore/sseToJsonHandler.js open-sse/handlers/responsesHandler.js open-sse/handlers/chatCore.js src/sse/handlers/chat.js src/app/api/v1/responses/compact/route.js tests/unit/body-read-deadline.test.js tests/unit/non-stream-body-timeout.test.js tests/unit/caller-abort-propagation.test.js tests/unit/stream-to-json-converter.test.js tests/unit/responses-stream-to-json-usage.test.js tests/unit/openai-responses-nonstream.test.js tests/unit/pr3445-nonrouting.test.js tests/unit/chat-connect-timeout-propagation.test.js
git commit -m "fix(timeout): own non-stream response body reads"
git log -1 --oneline
```

Expected: a new HEAD with subject `fix(timeout): own non-stream response body reads`.

**Incompatibility exclusions:** No timeout is added to streaming output, uploads, media routes, polling, arbitrary fetch helpers, or PR3632 header-deadline configuration. No successful body has rewritten payload, usage, or callback timing. Compact requests retain the original signal while only their body is rewritten.

## Task 2: Keyed Account-Failure Metadata and Client Status

**Files:**

- Create: `open-sse/config/modelErrorClassifier.js`
- Create: `tests/unit/model-lock-metadata.test.js`
- Create: `tests/unit/client-model-error-status.test.js`
- Create: `tests/unit/chat-core-client-status-metadata.test.js`
- Modify: `open-sse/services/accountFallback.js`
- Modify: `open-sse/utils/error.js`
- Modify: `open-sse/handlers/chatCore.js`
- Modify: `src/sse/services/auth.js`
- Modify: `src/sse/handlers/chat.js`
- Modify: `src/sse/handlers/embeddings.js`
- Modify: `src/sse/handlers/fetch.js`
- Modify: `src/sse/handlers/imageGeneration.js`
- Modify: `src/sse/handlers/jsonProxy.js`
- Modify: `src/sse/handlers/search.js`
- Modify: `src/sse/handlers/stt.js`
- Modify: `src/sse/handlers/tts.js`
- Modify: `src/sse/handlers/videoGeneration.js`
- Test: `tests/unit/github-monthly-usage-lock.test.js`
- Test: `tests/unit/qoder-quota-112-disable.test.js`
- Test: `tests/unit/noauth-session-id-3262.test.js`
- Test: `tests/unit/provider-error-detail-3424.test.js`

**Interfaces:**

- Consumes: existing `modelLock_<key>` ISO expiry fields, `buildModelLockUpdate`, `getEarliestModelLockUntil`, `isModelLockActive`, atomic top-level `updateProviderConnection`, `describeProviderError`, and `parseUpstreamError`.
- Produces: `MODEL_FAILURE_PREFIX = "modelFailure_"`, `getModelFailureKey(model)`, `buildModelFailureUpdate(model, { status, message, until, resetsAt, clientErrorStatus, unknownModelVerified })`, `getActiveModelFailure(connection, model)`, `buildModelLockUpdateAt(model, until)`, and paired clear helpers.
- Produces: `parseUpstreamError` internal result `{ statusCode, message, resetsAtMs, errorPayload }`; `errorPayload` is the parsed provider object retained only in memory until `chatCore` calls the classifier and is never placed in a client response, log, or connection record.
- Produces: `projectClientModelStatus({ provider, requestedModel, status, payload }) -> { clientErrorStatus, unknownModelVerified }`. A 404 requires both a provider-specific configured raw-status/code/shape predicate and exact requested-model equality. Every non-match, including generic prose, parameter validation, and non-model 401, preserves the raw status.
- Produces: `createErrorResult(rawStatus, message, resetsAtMs, failureMetadata)` with raw `status` and fallback behavior unchanged. The optional safe `failureMetadata` travels to `markAccountUnavailable`, not directly to an unrelated response.
- Produces: `getProviderCredentials` `allRateLimited` results whose `lastError`, `lastErrorCode`, `retryAfter`, `retryAfterHuman`, and optional `clientErrorStatus` all come from one exact model or `__all` pair.

- [ ] **Step 1: Establish atomic metadata isolation red tests**

Create `tests/unit/model-lock-metadata.test.js` with controlled time and a mocked transactional connection repository. Cover simultaneous alpha and beta failure writes to one connection, requested alpha reading only alpha, requested beta reading only beta, account-wide precedence, selected earliest expiry across connections, a legacy expiry with no metadata, and exact-plus-expired cleanup that leaves another active pair intact. Assert the selected `modelLock_<key>` and `modelFailure_<key>.until` are byte-for-byte the same one ISO value, including a precise provider reset.

Run:

```bash
cd tests
npx vitest run unit/model-lock-metadata.test.js
```

Expected: FAIL because modelFailure fields, exact-selection helpers, and a single-ISO write path do not exist. Current code reads flat `lastError` and the earliest lock across every model.

- [ ] **Step 2: Implement paired model-lock helpers and one-ISO write**

Add companion-key construction and read/clear helpers in `accountFallback.js`. Preserve existing `modelLock_<key>` expiry storage and UI-wide no-argument `getEarliestModelLockUntil` behavior. Add its optional model argument for exact selection. `getActiveModelFailure` first tests `modelLock___all`, then `modelLock_<requested>`, and returns only metadata with the same key and active `until`. An active legacy expiry returns generic unavailable data with null status.

In `markAccountUnavailable`, compute the final expiry once after Qoder, GitHub, precise reset, and ordinary backoff decisions: `const until = new Date(now + cooldownMs).toISOString()`. Pass that exact string to `buildModelLockUpdateAt` and `buildModelFailureUpdate`. Do not call `Date.now()` again to derive metadata expiry. Preserve Qoder code 112 deactivation, GitHub account-wide `__all` locking, raw `status`, `shouldFallback`, and existing backoff behavior.

Run:

```bash
cd tests
npx vitest run unit/model-lock-metadata.test.js unit/github-monthly-usage-lock.test.js unit/qoder-quota-112-disable.test.js
```

Expected: PASS. Existing GitHub account-wide and Qoder special cases retain their current expiry or disable behavior, and every active pair shares exactly one stored `until`.

- [ ] **Step 3: Establish parsed-payload classifier and public-status red tests**

Create `tests/unit/client-model-error-status.test.js` with a table of provider, requested model, raw status, parsed payload, and expected `{ clientErrorStatus, unknownModelVerified }`. Include one positive configured unknown-model signature, generic `ModelError` prose, a non-model 401, invalid request parameters, and no selected metadata.

Create `tests/unit/chat-core-client-status-metadata.test.js`. Mock a failed upstream Response with a structured JSON payload and assert `parseUpstreamError` retains it only through `handleChatCore`, which returns raw status plus safe metadata for `markAccountUnavailable`. Assert the handler receives a 404 only when the exact configured predicate matches, and generic error text cannot alter client status. Exercise selected `allRateLimited` output for chat, embeddings, fetch, image, JSON proxy, search, STT, TTS, and video paths.

Run:

```bash
cd tests
npx vitest run unit/client-model-error-status.test.js unit/chat-core-client-status-metadata.test.js
```

Expected: FAIL because the parser discards structured payload, no provider-keyed classifier or `clientErrorStatus` exists, and handlers derive status from cross-model flat fields.

- [ ] **Step 4: Implement safe capture, exact selection, and response projection**

In `open-sse/utils/error.js`, parse JSON once and return it as internal `errorPayload` alongside existing text and reset extraction. Keep the public `errorResponse` body and raw upstream status behavior unchanged. In `open-sse/handlers/chatCore.js`, call `projectClientModelStatus` immediately after `parseUpstreamError`, before its payload is formatted or discarded; attach only `clientErrorStatus` and `unknownModelVerified` to the error result's `failureMetadata`.

Update `src/sse/handlers/chat.js` to forward `result.failureMetadata` into `markAccountUnavailable`, preserve `result.status` for fallback decisions and `lastStatus`, and use selected `credentials.clientErrorStatus ?? lastStatus ?? Number(credentials.lastErrorCode)` only in its `allRateLimited` client response. Update `auth.js` so `markAccountUnavailable` writes the selected model pair after `describeProviderError`, `clearAccountError` clears matched pairs, and `getProviderCredentials` selects exactly one lock/metadata pair.

At every listed credentialed handler `allRateLimited` branch, use only the selected `clientErrorStatus` for response projection while preserving raw upstream `result.status` for `markAccountUnavailable`, `shouldFallback`, retry, and normal direct failure behavior. A direct rejected request parameter returns without model lock creation. Do not expose connection names, another model name, another error, another status, parsed payload, or another reset in the client body.

Run:

```bash
cd tests
npx vitest run unit/model-lock-metadata.test.js unit/client-model-error-status.test.js unit/chat-core-client-status-metadata.test.js unit/github-monthly-usage-lock.test.js unit/qoder-quota-112-disable.test.js unit/noauth-session-id-3262.test.js unit/provider-error-detail-3424.test.js
```

Expected: PASS.

- [ ] **Step 5: Run Task 2 static and scope gates**

Run:

```bash
npx eslint open-sse/config/modelErrorClassifier.js open-sse/services/accountFallback.js open-sse/utils/error.js open-sse/handlers/chatCore.js src/sse/services/auth.js src/sse/handlers/chat.js src/sse/handlers/embeddings.js src/sse/handlers/fetch.js src/sse/handlers/imageGeneration.js src/sse/handlers/jsonProxy.js src/sse/handlers/search.js src/sse/handlers/stt.js src/sse/handlers/tts.js src/sse/handlers/videoGeneration.js tests/unit/model-lock-metadata.test.js tests/unit/client-model-error-status.test.js tests/unit/chat-core-client-status-metadata.test.js
git diff --check
git diff --name-only
```

Expected: ESLint exits 0, diff check has no output, and changed runtime paths equal Task 2's file list.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add open-sse/config/modelErrorClassifier.js open-sse/services/accountFallback.js open-sse/utils/error.js open-sse/handlers/chatCore.js src/sse/services/auth.js src/sse/handlers/chat.js src/sse/handlers/embeddings.js src/sse/handlers/fetch.js src/sse/handlers/imageGeneration.js src/sse/handlers/jsonProxy.js src/sse/handlers/search.js src/sse/handlers/stt.js src/sse/handlers/tts.js src/sse/handlers/videoGeneration.js tests/unit/model-lock-metadata.test.js tests/unit/client-model-error-status.test.js tests/unit/chat-core-client-status-metadata.test.js tests/unit/github-monthly-usage-lock.test.js tests/unit/qoder-quota-112-disable.test.js tests/unit/noauth-session-id-3262.test.js tests/unit/provider-error-detail-3424.test.js
git commit -m "fix(auth): scope account failures to models"
git log -1 --oneline
```

Expected: a new HEAD with subject `fix(auth): scope account failures to models`.

**Incompatibility exclusions:** Do not migrate the database, rename existing `modelLock` fields, create a nested shared metadata object, alter Qoder code 112 disabling, alter GitHub monthly locking, let generic model prose create a 404, or replace raw upstream status in fallback and retry decisions.

## Task 3: Typed Client-SSE Terminal Observation

**Files:**

- Create: `open-sse/utils/streamTerminal.js`
- Create: `tests/unit/sse-terminal-observer.test.js`
- Create: `tests/unit/stream-terminal-contract.test.js`
- Modify: `open-sse/utils/streamHandler.js`
- Modify: `open-sse/handlers/chatCore/streamingHandler.js`
- Test: `tests/unit/responses-abort-terminal.test.js`
- Test: `tests/unit/sse-keepalive.test.js`
- Test: `tests/unit/ttft-watchdog.test.js`
- Test: `tests/unit/stream-newline-scanner.test.js`
- Test: `tests/unit/openai-responses-terminal-event.test.js`
- Test: `tests/unit/openai-responses-nonstream.test.js`

**Interfaces:**

- Consumes: `FORMATS`, `buildAbortedResponsesTerminalBytes`, existing `createDisconnectAwareStream`, existing `pipeWithDisconnect` positional callers, and post-transform client bytes.
- Produces: `MAX_SSE_TERMINAL_RECORD_BYTES = 65536` and `MAX_SSE_TERMINAL_DATA_LINES = 128`. `createSseTerminalObserver(emittedFormat)` returns null for unsupported formats, or an observer with `observe(bytes)`, `sawTerminal()`, `buildIncompleteTerminal()`, and `release()`.
- Produces: bounded parsing. An event record exceeding 65536 UTF-8 bytes or 128 data lines is marked unproven, discarded through its next blank-line boundary, and parser record state is reset. Bytes are always enqueued unchanged. A later complete typed terminal may still be recognized. `release()` clears buffered text, byte counters, data-line count, discard state, and decoder carry at normal completion, abnormal completion, and downstream cancellation.
- Produces: normalized pipe options `{ onAbortTerminal, stallTimeoutMs, ttftTimeoutMs, keepaliveMs, terminalObserver, onIncompleteStream }`, while retaining legacy `pipeWithDisconnect(response, transform, controller, onAbortTerminal, stallTimeoutMs, ttftTimeoutMs, keepaliveMs)`.
- Produces: `buildTransformStream` returns `{ transformStream, emittedFormat }`, where `emittedFormat` is the client format after its translator branch. `onIncompleteStream(error)` is called exactly once for a supported stream missing a proven terminal, so its existing abandonment path runs and `handleComplete` does not.

- [ ] **Step 1: Establish bounded typed-record parser red tests**

Create `tests/unit/sse-terminal-observer.test.js`. Feed OpenAI, Claude, and Responses terminal records across arbitrary byte chunk boundaries, CRLF boundaries, and a split UTF-8 code point. Add literal content-block text containing `message_stop`, Responses text containing `response.completed`, and OpenAI content containing `[DONE]`. Each must remain non-terminal until a complete typed terminal record arrives.

Add an unterminated 65537-byte record and a 129-data-line record. Assert the observer enters discard-through-boundary mode, retains no unbounded data, preserves every input byte, resets at the following blank line, and can recognize a later terminal record. Assert `release()` clears state after normal, error, and cancellation paths.

Run:

```bash
cd tests
npx vitest run unit/sse-terminal-observer.test.js
```

Expected: FAIL because the observer module, hard record limits, overflow discard behavior, and release API do not exist.

- [ ] **Step 2: Implement the bounded observer**

Create `streamTerminal.js`. Keep one streaming TextDecoder while input is active, parse only complete blank-line-delimited SSE records, join data lines, and JSON-decode payloads. Accept only exact OpenAI `[DONE]` or non-null `finish_reason`, Claude `type: "message_stop"`, and Responses event or payload types `response.completed`, `response.done`, `response.failed`, or `response.incomplete`. Return null for every other emitted format.

Do not inspect content text for terminal words. On either explicit record limit, discard parse material until the next complete blank-line record boundary, then reset record counters without changing, dropping, delaying, or re-encoding client bytes. `release()` must be idempotent.

Run:

```bash
cd tests
npx vitest run unit/sse-terminal-observer.test.js unit/openai-responses-terminal-event.test.js
```

Expected: PASS. The observer never mutates passed bytes, bounded overflow is unproven rather than terminal, and a later valid terminal is accepted.

- [ ] **Step 3: Establish post-transform lifecycle and timing red tests**

Create `tests/unit/stream-terminal-contract.test.js`. Use a transform that emits its terminal only in `flush` and another that drops mid-stream. Verify normal EOF after a real transformed terminal does not synthesize; incomplete EOF, network reset, stall, overflow-then-EOF, and transform error each enqueue exactly one correct typed terminal then invoke the abandonment/error lifecycle, never `handleComplete`. Verify downstream reader cancellation enqueues no synthetic failure and calls `release()`.

Add fake-timer assertions that normal OpenAI, Claude, and Responses terminal streams preserve PR3632's positional `onAbortTerminal, stallTimeoutMs, ttftTimeoutMs, keepaliveMs` meanings, TTFT cutoff, upstream-byte stall clock, keepalive cadence and placement. No healthy stream may gain output bytes, timer arms, or completion delay.

Run:

```bash
cd tests
npx vitest run unit/stream-terminal-contract.test.js
```

Expected: FAIL because `pipeWithDisconnect` has no options object, no post-transform typed observer, and normal EOF always invokes `handleComplete`.

- [ ] **Step 4: Normalize options, wire emitted format, and route abnormal EOF**

In `streamHandler.js`, accept either legacy positional values or one options object. Normalize once before arming existing TTFT, stall, and keepalive timers. Do not reinterpret a sixth positional argument. Pass `terminalObserver` and `onIncompleteStream` only to `createDisconnectAwareStream`; it calls `observe(value)` before enqueue.

For a supported observer without a proven terminal at EOF, network reset, stall, transform error, or bounded-overflow EOF, enqueue `buildIncompleteTerminal()` at most once, invoke `onIncompleteStream(error)` and `streamController.handleError(error)`, call `release()`, then close. It must not call `handleComplete`. On a recognized terminal, preserve normal `handleComplete`. On downstream `cancel(reason)`, preserve the current disconnect semantics, emit no synthetic terminal, and call `release()`. Unsupported formats keep their existing EOF semantics.

In `streamingHandler.js`, return both `transformStream` and the effective `emittedFormat` from every `buildTransformStream` branch. Construct the observer from that emitted format and call `pipeWithDisconnect` with the named object, supplying existing stream abandonment as `onIncompleteStream`. Retain the current Responses abort builder. Its existing transform-level Responses terminal remains valid when the post-transform observer recognizes its bytes, preventing duplication.

Run:

```bash
cd tests
npx vitest run unit/sse-terminal-observer.test.js unit/stream-terminal-contract.test.js unit/responses-abort-terminal.test.js unit/sse-keepalive.test.js unit/ttft-watchdog.test.js unit/stream-newline-scanner.test.js unit/openai-responses-terminal-event.test.js unit/openai-responses-nonstream.test.js
```

Expected: PASS. Every supported incomplete path yields one typed terminal plus abandonment, a healthy terminal remains byte/timing-identical, and legacy positional timing calls remain semantically identical.

- [ ] **Step 5: Run Task 3 static and scope gates**

Run:

```bash
npx eslint open-sse/utils/streamTerminal.js open-sse/utils/streamHandler.js open-sse/handlers/chatCore/streamingHandler.js tests/unit/sse-terminal-observer.test.js tests/unit/stream-terminal-contract.test.js
git diff --check
git diff --name-only
```

Expected: ESLint exits 0, diff check has no output, and changed runtime paths equal Task 3's file list.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add open-sse/utils/streamTerminal.js open-sse/utils/streamHandler.js open-sse/handlers/chatCore/streamingHandler.js tests/unit/sse-terminal-observer.test.js tests/unit/stream-terminal-contract.test.js tests/unit/responses-abort-terminal.test.js tests/unit/sse-keepalive.test.js tests/unit/ttft-watchdog.test.js tests/unit/stream-newline-scanner.test.js tests/unit/openai-responses-terminal-event.test.js tests/unit/openai-responses-nonstream.test.js
git commit -m "fix(stream): synthesize typed incomplete terminals"
git log -1 --oneline
```

Expected: a new HEAD with subject `fix(stream): synthesize typed incomplete terminals`.

**Incompatibility exclusions:** Do not alter raw provider bytes, translator behavior, existing normal Responses terminal bytes, timer constants, keepalive placement, or client cancellation semantics. Do not synthesize for a format without an exact typed terminal predicate. Do not retain unbounded partial SSE record data.

## Task 4: Combined Verification and Independent Review

**Files:**

- Modify: no runtime or test file
- Verify: all Task 1 through Task 3 files
- Verify: `tests/__baseline__/verify-no-regression.mjs`
- Verify: `package.json` build scripts
- Verify: `docs/superpowers/specs/2026-08-30-response-safety-batch-design.md`
- Verify: `docs/superpowers/plans/2026-08-30-joint-response-safety-adaptation.md`

**Interfaces:**

- Consumes: all three accepted task commits and the status matrix in the design.
- Produces: an evidence receipt with focused, adjacent, full-suite verifier, build, static, diff, scope, and independent review results. It produces no new behavior.

- [ ] **Step 1: Re-run the combined focused matrix**

Run:

```bash
cd tests
npx vitest run unit/caller-abort-propagation.test.js unit/body-read-deadline.test.js unit/non-stream-body-timeout.test.js unit/stream-to-json-converter.test.js unit/responses-stream-to-json-usage.test.js unit/model-lock-metadata.test.js unit/client-model-error-status.test.js unit/chat-core-client-status-metadata.test.js unit/sse-terminal-observer.test.js unit/stream-terminal-contract.test.js
```

Expected: PASS with public caller propagation, 499/502/504 mapping, one-ISO metadata selection, parsed-payload status safety, terminal bounds, and abnormal EOF represented.

- [ ] **Step 2: Re-run the combined adjacent matrix**

Run:

```bash
cd tests
npx vitest run unit/chat-connect-timeout-propagation.test.js unit/openai-responses-nonstream.test.js unit/pr3445-nonrouting.test.js unit/github-monthly-usage-lock.test.js unit/qoder-quota-112-disable.test.js unit/noauth-session-id-3262.test.js unit/provider-error-detail-3424.test.js unit/responses-abort-terminal.test.js unit/sse-keepalive.test.js unit/ttft-watchdog.test.js unit/stream-newline-scanner.test.js unit/openai-responses-terminal-event.test.js
```

Expected: PASS.

- [ ] **Step 3: Run the full regression verifier**

Run the raw Vitest suite once, save its JSON result to a fresh temporary directory, record the raw exit code, then run `tests/__baseline__/verify-no-regression.mjs` against that JSON.

Run:

```bash
RUN_DIR="$(mktemp -d)"
cd tests
npx vitest run --reporter=json --outputFile="$RUN_DIR/results.json"
RAW_VITEST_EXIT=$?
node __baseline__/verify-no-regression.mjs "$RUN_DIR/results.json"
echo "$RAW_VITEST_EXIT"
```

Expected: the verifier exits 0. The raw suite exit may remain nonzero only for documented baseline failures. Any verifier failure is a regression and blocks integration.

- [ ] **Step 4: Run static, production, diff, and scope gates**

Run:

```bash
npx eslint open-sse src/sse tests/unit
npm run build
git diff --check 04da36d30..HEAD
git diff --name-status 04da36d30..HEAD
git diff --stat 04da36d30..HEAD
git status --short --branch
```

Expected: ESLint and build exit 0, diff check has no output, scope contains only the planned implementation and test paths plus the two accepted documentation artifacts, and the worktree is clean.

- [ ] **Step 5: Perform independent review and report readiness**

Review the final diff against the design. Confirm:

- Every selected non-stream body consumer receives the original public Request.signal and never streamController.signal as caller identity.
- A typed client abort short-circuits public request/replay/fallback paths before account mutation, while header timeout is 502, body stall is 504, and malformed/unrelated reader errors are 502.
- The compact replay preserves its caller signal, and direct Chat, Messages, Responses, and Ollama routes preserve theirs.
- Metadata never crosses alpha, beta, and __all boundaries, and each selected lock/metadata pair shares one exact ISO until.
- Raw upstream status remains the fallback/retry status. Only parsed, provider-keyed, requested-model-verified metadata may project a 404.
- Existing positional TTFT and keepalive calls retain their meaning and normal stream timing/output.
- Content prose, oversized records, and unsupported formats cannot forge a terminal. A supported incomplete stream sends one terminal then the abandonment/error lifecycle, never handleComplete.
- No untouched behavior was broadened.

Expected: either an approval with no findings or a bounded findings list that returns to the owning task. Do not push, merge, update tracking, or modify upstream state from this plan.

## Plan Self-Review

The repair closes the caller-identity, metadata capture, and terminal-boundary gaps. Task 1 owns the original request signal through public routes, compact replay, account/replay calls, core, and reader lifecycle. Task 2 owns parsed-payload capture, one-ISO model metadata, exact selection, and safe client projection. Task 3 owns a 65536-byte/128-data-line bounded post-transform parser, release cleanup, and one-terminal abnormal lifecycle. Task 4 verifies all focused, adjacent, full, static, diff, scope, and review gates. Every code-changing task begins with tests-only RED evidence, carries a GREEN command, lists explicit staged files, and excludes incompatible behavior.
