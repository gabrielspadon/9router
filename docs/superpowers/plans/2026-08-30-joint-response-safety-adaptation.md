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
- Map caller cancellation to 499 with no account mutation, body timeout to 504 with one ordinary fallback transition, malformed body and unrelated reader failures to 502.
- Do not call Response.text(), Response.json(), or response.body.cancel() in a path that claims reader-owned cleanup.
- Keep modelLock_<key> expiry fields. Store metadata as independent top-level modelFailure_<key> fields, never a shared map.
- Select only the active __all lock or exact requested-model lock. __all takes precedence.
- Return 404 only from a provider-keyed, structured unknown-model predicate that proves the requested model. Generic prose is not proof.
- Keep raw upstream status for fallback. Project client status separately.
- Preserve legacy pipeWithDisconnect positional arguments in this exact order: onAbortTerminal, stallTimeoutMs, ttftTimeoutMs, keepaliveMs.
- Observe complete client-emitted SSE records after translation. Never scan content prose for terminal words and never synthesize a terminal for an unsupported format.
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
| open-sse/handlers/responsesHandler.js | Deadline-aware non-streaming /v1/responses conversion. |
| open-sse/handlers/chatCore.js | Pass the live stream-controller signal and preserve 499, 502, and 504 result lifecycle. |
| open-sse/services/accountFallback.js | Exact and account-wide lock pair helpers. |
| open-sse/config/modelErrorClassifier.js | Provider-keyed structured unknown-model predicates and client-status projection. |
| src/sse/services/auth.js | Credential selection, lock writes, lock cleanup, selected metadata result. |
| src/sse/handlers/chat.js | Chat allRateLimited client-status projection. |
| src/sse/handlers/embeddings.js | Embeddings allRateLimited client-status projection. |
| src/sse/handlers/fetch.js | Fetch allRateLimited client-status projection. |
| src/sse/handlers/imageGeneration.js | Image allRateLimited client-status projection. |
| src/sse/handlers/jsonProxy.js | JSON proxy allRateLimited client-status projection. |
| src/sse/handlers/search.js | Search allRateLimited client-status projection. |
| src/sse/handlers/stt.js | STT allRateLimited client-status projection. |
| src/sse/handlers/tts.js | TTS allRateLimited client-status projection. |
| src/sse/handlers/videoGeneration.js | Video allRateLimited client-status projection. |
| open-sse/utils/streamTerminal.js | Bounded typed client-SSE terminal observer. |
| open-sse/utils/streamHandler.js | Options normalization, observer placement, one synthetic terminal lifecycle. |
| open-sse/handlers/chatCore/streamingHandler.js | Client emitted-format reporting and named pipe options. |

The source files above are owned only by their named task. Task 4 modifies no runtime file.

## Task 1: Reader-Owned Non-Streaming Body Deadline

**Files:**

- Create: open-sse/utils/bodyTimeout.js
- Create: tests/unit/body-read-deadline.test.js
- Create: tests/unit/non-stream-body-timeout.test.js
- Modify: open-sse/config/runtimeConfig.js
- Modify: open-sse/transformer/streamToJsonConverter.js
- Modify: open-sse/handlers/chatCore/nonStreamingHandler.js
- Modify: open-sse/handlers/chatCore/sseToJsonHandler.js
- Modify: open-sse/handlers/responsesHandler.js
- Modify: open-sse/handlers/chatCore.js
- Test: tests/unit/stream-to-json-converter.test.js
- Test: tests/unit/responses-stream-to-json-usage.test.js
- Test: tests/unit/openai-responses-nonstream.test.js
- Test: tests/unit/pr3445-nonrouting.test.js
- Test: tests/unit/chat-connect-timeout-propagation.test.js

**Interfaces:**

- Consumes: existing HTTP_STATUS, current streamController.signal, and convertResponsesStreamToJson(stream).
- Produces: BodyReadTimeoutError with name BodyReadTimeoutError, code UPSTREAM_RESPONSE_BODY_TIMEOUT, and timeoutMs; isBodyReadTimeoutError(error); consumeResponseBodyWithDeadline({ body, signal, timeoutMs, consume }); readResponseTextWithDeadline(options); readResponseJsonWithDeadline(options).
- Produces: convertResponsesStreamToJson(stream, { reader } = {}) where a supplied reader is consumed but never released by the converter.
- Produces: handlers which return 499 only for the supplied caller signal, 504 only for BodyReadTimeoutError, and 502 for malformed or unrelated reader errors.

- [ ] **Step 1: Establish the body-owner red tests**

Create tests/unit/body-read-deadline.test.js with a controllable ReadableStream that records getReader, read, cancel, and releaseLock. Cover a UTF-8 split text body, valid JSON body, timer-first stall, caller-first abort, late EOF after timeout, and idempotent cleanup.

Run:

```bash
cd tests
npx vitest run unit/body-read-deadline.test.js
```

Expected: FAIL because bodyTimeout.js and its named exports do not exist.

- [ ] **Step 2: Implement the isolated reader owner**

Add RESPONSE_BODY_TIMEOUT_MS near FETCH_CONNECT_TIMEOUT_MS with default 300000 and the existing positive env parser. Add bodyTimeout.js. The consumer receives the acquired reader, not the raw stream. Timer and caller listeners first set one terminal source, then cancel that reader for deadline or caller abort, and the owner releases the lock exactly once in its finalization path. Text decoding uses a streaming TextDecoder and JSON parsing occurs only after complete decoded text.

Do not use Promise.race around Response.text() or Response.json(). Do not offer an unbounded opt-out.

Run:

```bash
cd tests
npx vitest run unit/body-read-deadline.test.js
```

Expected: PASS. The timer case proves reader.cancel receives BodyReadTimeoutError, caller abort preserves its original reason, and no late success is returned.

- [ ] **Step 3: Make the Responses converter ownership-compatible**

Modify convertResponsesStreamToJson to retain its current stream-only API and accept an optional reader. It must acquire and release a reader only in the stream-only form. When the body owner provides reader, the outer owner alone releases it.

Extend tests/unit/stream-to-json-converter.test.js and tests/unit/responses-stream-to-json-usage.test.js with an externally acquired reader fixture and its release counter.

Run:

```bash
cd tests
npx vitest run unit/stream-to-json-converter.test.js unit/responses-stream-to-json-usage.test.js
```

Expected: FAIL before the converter accepts the supplied reader, then PASS with the existing direct-stream expectations unchanged.

- [ ] **Step 4: Write consumer-level red tests**

Create tests/unit/non-stream-body-timeout.test.js. Use fake timers and response streams to exercise ordinary non-streaming JSON, Chat-Completions forced SSE, Gemini forced SSE, forced Responses SSE, and /v1/responses forced SSE. For each path test healthy completion, body stall, malformed payload, and caller cancellation. Mock the outer credential loop once to assert a body 504 reaches exactly one ordinary markAccountUnavailable transition while a caller 499 reaches none.

Run:

```bash
cd tests
npx vitest run unit/non-stream-body-timeout.test.js
```

Expected: FAIL because callers still use convenience readers and no path distinguishes 499, 502, and 504.

- [ ] **Step 5: Integrate only the non-streaming consumers**

Pass streamController.signal through both shared contexts in handleChatCore and into nonStreamingHandler, sseToJsonHandler, and responsesHandler. Replace only their direct JSON, text, and Responses converter body reads with the Task 1 owner. Classify BodyReadTimeoutError as GATEWAY_TIMEOUT before malformed-payload handling. Keep ConnectTimeoutError on its existing mapTransportError 502 path.

Call trackDone, success callback, usage persistence, and streamController.handleComplete only after a successful body result. Let a 504 return as an ordinary failed upstream attempt so the outer credential loop owns exactly one fallback decision. Let a caller abort return the established 499 result before fallback.

Run:

```bash
cd tests
npx vitest run unit/body-read-deadline.test.js unit/non-stream-body-timeout.test.js unit/stream-to-json-converter.test.js unit/responses-stream-to-json-usage.test.js unit/openai-responses-nonstream.test.js unit/pr3445-nonrouting.test.js unit/chat-connect-timeout-propagation.test.js
```

Expected: PASS.

- [ ] **Step 6: Run Task 1 static and scope gates**

Run:

```bash
npx eslint open-sse/config/runtimeConfig.js open-sse/utils/bodyTimeout.js open-sse/transformer/streamToJsonConverter.js open-sse/handlers/chatCore/nonStreamingHandler.js open-sse/handlers/chatCore/sseToJsonHandler.js open-sse/handlers/responsesHandler.js open-sse/handlers/chatCore.js tests/unit/body-read-deadline.test.js tests/unit/non-stream-body-timeout.test.js
git diff --check
git diff --name-only
```

Expected: ESLint exits 0, diff check has no output, and the changed runtime paths equal Task 1's file list.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add open-sse/config/runtimeConfig.js open-sse/utils/bodyTimeout.js open-sse/transformer/streamToJsonConverter.js open-sse/handlers/chatCore/nonStreamingHandler.js open-sse/handlers/chatCore/sseToJsonHandler.js open-sse/handlers/responsesHandler.js open-sse/handlers/chatCore.js tests/unit/body-read-deadline.test.js tests/unit/non-stream-body-timeout.test.js tests/unit/stream-to-json-converter.test.js tests/unit/responses-stream-to-json-usage.test.js tests/unit/openai-responses-nonstream.test.js tests/unit/pr3445-nonrouting.test.js tests/unit/chat-connect-timeout-propagation.test.js
git commit -m "fix(timeout): own non-stream response body reads"
git log -1 --oneline
```

Expected: a new HEAD with subject fix(timeout): own non-stream response body reads.

**Incompatibility exclusions:** No timeout is added to streaming output, uploads, media routes, polling, arbitrary fetch helpers, or PR3632 header-deadline configuration. No successful body has rewritten payload, usage, or callback timing.

## Task 2: Keyed Account-Failure Metadata and Client Status

**Files:**

- Create: open-sse/config/modelErrorClassifier.js
- Create: tests/unit/model-lock-metadata.test.js
- Create: tests/unit/client-model-error-status.test.js
- Modify: open-sse/services/accountFallback.js
- Modify: src/sse/services/auth.js
- Modify: src/sse/handlers/chat.js
- Modify: src/sse/handlers/embeddings.js
- Modify: src/sse/handlers/fetch.js
- Modify: src/sse/handlers/imageGeneration.js
- Modify: src/sse/handlers/jsonProxy.js
- Modify: src/sse/handlers/search.js
- Modify: src/sse/handlers/stt.js
- Modify: src/sse/handlers/tts.js
- Modify: src/sse/handlers/videoGeneration.js
- Test: tests/unit/github-monthly-usage-lock.test.js
- Test: tests/unit/qoder-quota-112-disable.test.js
- Test: tests/unit/noauth-session-id-3262.test.js
- Test: tests/unit/provider-error-detail-3424.test.js

**Interfaces:**

- Consumes: existing modelLock_<key> ISO expiry fields, buildModelLockUpdate, getEarliestModelLockUntil, isModelLockActive, updateProviderConnection atomic top-level merge, and describeProviderError.
- Produces: MODEL_FAILURE_PREFIX = modelFailure_, getModelFailureKey(model), buildModelFailureUpdate(model, { status, message, until, resetsAt }), getActiveModelFailure(connection, model), and paired clear helpers.
- Produces: getProviderCredentials allRateLimited results with lastError, lastErrorCode, retryAfter, retryAfterHuman, and clientErrorStatus all selected from one exact model or __all lock.
- Produces: projectClientModelStatus({ provider, requestedModel, status, payload }) that returns 404 only for a configured provider-specific structured match, otherwise preserves the given status.

- [ ] **Step 1: Establish metadata isolation red tests**

Create tests/unit/model-lock-metadata.test.js with controlled time and a mocked transactional connection repository. Cover simultaneous alpha and beta failure writes to one connection, requested alpha reading only alpha, requested beta reading only beta, account-wide precedence, selected earliest expiry across connections, a legacy expiry with no metadata, and exact-plus-expired cleanup that leaves another active pair intact.

Run:

```bash
cd tests
npx vitest run unit/model-lock-metadata.test.js
```

Expected: FAIL because modelFailure fields and exact-selection helpers do not exist, and current code reads flat lastError and the earliest lock across every model.

- [ ] **Step 2: Implement paired model-lock helpers**

Add companion-key construction and read/clear helpers in accountFallback.js. Preserve existing modelLock_<key> expiry storage and UI-wide no-argument getEarliestModelLockUntil behavior. Add its optional model argument for exact selection. getActiveModelFailure must first test modelLock___all, then modelLock_<requested>, and only return metadata that has the same key and active until value. An active legacy expiry returns generic unavailable data with null status.

Run:

```bash
cd tests
npx vitest run unit/model-lock-metadata.test.js unit/github-monthly-usage-lock.test.js unit/qoder-quota-112-disable.test.js
```

Expected: PASS. Existing GitHub account-wide and Qoder special cases retain their current expiry or disable behavior.

- [ ] **Step 3: Establish client-status projection red tests**

Create tests/unit/client-model-error-status.test.js. Use a table of provider, requested model, raw status, structured payload, and expected client status. Include one positive configured unknown-model signature, generic ModelError prose, a non-model 401, invalid request parameters, and selected allRateLimited output for each credentialed handler category.

Run:

```bash
cd tests
npx vitest run unit/client-model-error-status.test.js
```

Expected: FAIL because no provider-keyed classifier or clientErrorStatus exists and handler responses derive status from cross-model flat fields.

- [ ] **Step 4: Implement exact selection and projection**

Create modelErrorClassifier.js as a provider-keyed table. Each entry requires a known provider identifier, an allowed raw status set, a structured error code or shape, and requested-model equality. Do not match generic text. Update auth.js so markAccountUnavailable writes the lock pair after describeProviderError, clearAccountError clears matched pairs, and getProviderCredentials chooses one selected lock and returns clientErrorStatus from its matching metadata.

At every listed handler allRateLimited branch, use the selected clientErrorStatus only for the response status. Preserve raw result.status for markAccountUnavailable, existing shouldFallback checks, and retry decisions. A direct rejected request parameter must return without model lock creation. Do not expose connection names, another model name, another error, another status, or another reset in the client body.

Run:

```bash
cd tests
npx vitest run unit/model-lock-metadata.test.js unit/client-model-error-status.test.js unit/github-monthly-usage-lock.test.js unit/qoder-quota-112-disable.test.js unit/noauth-session-id-3262.test.js unit/provider-error-detail-3424.test.js
```

Expected: PASS.

- [ ] **Step 5: Run Task 2 static and scope gates**

Run:

```bash
npx eslint open-sse/config/modelErrorClassifier.js open-sse/services/accountFallback.js src/sse/services/auth.js src/sse/handlers/chat.js src/sse/handlers/embeddings.js src/sse/handlers/fetch.js src/sse/handlers/imageGeneration.js src/sse/handlers/jsonProxy.js src/sse/handlers/search.js src/sse/handlers/stt.js src/sse/handlers/tts.js src/sse/handlers/videoGeneration.js tests/unit/model-lock-metadata.test.js tests/unit/client-model-error-status.test.js
git diff --check
git diff --name-only
```

Expected: ESLint exits 0, diff check has no output, and changed runtime paths equal Task 2's file list.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add open-sse/config/modelErrorClassifier.js open-sse/services/accountFallback.js src/sse/services/auth.js src/sse/handlers/chat.js src/sse/handlers/embeddings.js src/sse/handlers/fetch.js src/sse/handlers/imageGeneration.js src/sse/handlers/jsonProxy.js src/sse/handlers/search.js src/sse/handlers/stt.js src/sse/handlers/tts.js src/sse/handlers/videoGeneration.js tests/unit/model-lock-metadata.test.js tests/unit/client-model-error-status.test.js tests/unit/github-monthly-usage-lock.test.js tests/unit/qoder-quota-112-disable.test.js tests/unit/noauth-session-id-3262.test.js tests/unit/provider-error-detail-3424.test.js
git commit -m "fix(auth): scope account failures to models"
git log -1 --oneline
```

Expected: a new HEAD with subject fix(auth): scope account failures to models.

**Incompatibility exclusions:** Do not migrate the database, rename existing modelLock fields, create a nested shared metadata object, alter Qoder code 112 disabling, alter GitHub monthly locking, or let generic model prose create a 404.

## Task 3: Typed Client-SSE Terminal Observation

**Files:**

- Create: open-sse/utils/streamTerminal.js
- Create: tests/unit/sse-terminal-observer.test.js
- Create: tests/unit/stream-terminal-contract.test.js
- Modify: open-sse/utils/streamHandler.js
- Modify: open-sse/handlers/chatCore/streamingHandler.js
- Test: tests/unit/responses-abort-terminal.test.js
- Test: tests/unit/sse-keepalive.test.js
- Test: tests/unit/ttft-watchdog.test.js
- Test: tests/unit/stream-newline-scanner.test.js
- Test: tests/unit/openai-responses-terminal-event.test.js
- Test: tests/unit/openai-responses-nonstream.test.js

**Interfaces:**

- Consumes: FORMATS, buildAbortedResponsesTerminalBytes, existing createDisconnectAwareStream, existing pipeWithDisconnect positional callers, and post-transform client bytes.
- Produces: createSseTerminalObserver(emittedFormat), returning null for unsupported formats or an observer with observe(bytes), sawTerminal(), and buildIncompleteTerminal().
- Produces: normalized pipe options { onAbortTerminal, stallTimeoutMs, ttftTimeoutMs, keepaliveMs, terminalObserver }, while retaining legacy pipeWithDisconnect(response, transform, controller, onAbortTerminal, stallTimeoutMs, ttftTimeoutMs, keepaliveMs).
- Produces: buildTransformStream returns { transformStream, emittedFormat } where emittedFormat is the client format after its translator branch.

- [ ] **Step 1: Establish typed-record parser red tests**

Create tests/unit/sse-terminal-observer.test.js. Feed OpenAI, Claude, and Responses terminal records across arbitrary byte chunk boundaries, CRLF boundaries, and a split UTF-8 code point. Add literal content-block text containing message_stop, Response text containing response.completed, and OpenAI content containing [DONE]. Test each is non-terminal until a complete typed terminal record arrives.

Run:

```bash
cd tests
npx vitest run unit/sse-terminal-observer.test.js
```

Expected: FAIL because the observer module does not exist.

- [ ] **Step 2: Implement the bounded observer**

Create streamTerminal.js. Maintain one streaming TextDecoder and a bounded event-record buffer. Parse completed blank-line-delimited SSE records, join data lines, and JSON-decode payloads. Accept only exact OpenAI [DONE] or non-null finish_reason, Claude type message_stop, and Responses event or payload types response.completed, response.done, response.failed, or response.incomplete. Return null for every other emitted format.

Run:

```bash
cd tests
npx vitest run unit/sse-terminal-observer.test.js unit/openai-responses-terminal-event.test.js
```

Expected: PASS. The observer does not mutate passed bytes.

- [ ] **Step 3: Establish post-transform lifecycle red tests**

Create tests/unit/stream-terminal-contract.test.js. Use a transform that emits its terminal only in flush and another that drops mid-stream. Verify normal EOF after a real transformed terminal does not synthesize; incomplete EOF, network reset, and stall synthesize one correct terminal; downstream reader cancellation synthesizes none; and normal OpenAI, Claude, and Responses streams receive no added bytes.

Run:

```bash
cd tests
npx vitest run unit/stream-terminal-contract.test.js
```

Expected: FAIL because pipeWithDisconnect has no options object or post-transform typed observer.

- [ ] **Step 4: Normalize options and wire emitted format**

In streamHandler.js, accept either legacy positional values or one options object. Normalize once before arming existing TTFT, stall, and keepalive timers. Do not reinterpret a sixth positional argument. Pass terminalObserver only to createDisconnectAwareStream, where observe(value) occurs before enqueue and EOF or network error synthesizes only if observer has no typed terminal. cancel(reason) remains a client path and emits no synthetic failure.

In streamingHandler.js, return both transformStream and emittedFormat from buildTransformStream. Construct the observer from emittedFormat and call pipeWithDisconnect with the named object. Retain current Responses abort builder. The existing transform-level Responses behavior may remain if its bytes are recognized by the post-transform observer, preventing duplication.

Run:

```bash
cd tests
npx vitest run unit/sse-terminal-observer.test.js unit/stream-terminal-contract.test.js unit/responses-abort-terminal.test.js unit/sse-keepalive.test.js unit/ttft-watchdog.test.js unit/stream-newline-scanner.test.js unit/openai-responses-terminal-event.test.js unit/openai-responses-nonstream.test.js
```

Expected: PASS.

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

Expected: a new HEAD with subject fix(stream): synthesize typed incomplete terminals.

**Incompatibility exclusions:** Do not alter raw provider bytes, translator behavior, existing normal Responses terminal bytes, timer constants, keepalive placement, or client cancellation semantics. Do not synthesize for a format without an exact typed terminal predicate.

## Task 4: Combined Verification and Independent Review

**Files:**

- Modify: no runtime or test file
- Verify: all Task 1 through Task 3 files
- Verify: tests/__baseline__/verify-no-regression.mjs
- Verify: package.json build scripts
- Verify: docs/superpowers/specs/2026-08-30-response-safety-batch-design.md
- Verify: docs/superpowers/plans/2026-08-30-joint-response-safety-adaptation.md

**Interfaces:**

- Consumes: all three accepted task commits and the status matrix in the design.
- Produces: an evidence receipt with focused, adjacent, full-suite verifier, build, static, diff, and scope results. It produces no new behavior.

- [ ] **Step 1: Re-run the combined focused matrix**

Run:

```bash
cd tests
npx vitest run unit/body-read-deadline.test.js unit/non-stream-body-timeout.test.js unit/stream-to-json-converter.test.js unit/responses-stream-to-json-usage.test.js unit/model-lock-metadata.test.js unit/client-model-error-status.test.js unit/sse-terminal-observer.test.js unit/stream-terminal-contract.test.js
```

Expected: PASS with every error mapping and terminal boundary represented.

- [ ] **Step 2: Re-run the combined adjacent matrix**

Run:

```bash
cd tests
npx vitest run unit/chat-connect-timeout-propagation.test.js unit/openai-responses-nonstream.test.js unit/pr3445-nonrouting.test.js unit/github-monthly-usage-lock.test.js unit/qoder-quota-112-disable.test.js unit/noauth-session-id-3262.test.js unit/provider-error-detail-3424.test.js unit/responses-abort-terminal.test.js unit/sse-keepalive.test.js unit/ttft-watchdog.test.js unit/stream-newline-scanner.test.js unit/openai-responses-terminal-event.test.js
```

Expected: PASS.

- [ ] **Step 3: Run the full regression verifier**

Run the raw Vitest suite once, save its JSON result to a fresh temporary directory, record the raw exit code, then run tests/__baseline__/verify-no-regression.mjs against that JSON.

Run:

```bash
RUN_DIR="$(mktemp -d)"
cd tests
npx vitest run --reporter=json --outputFile="$RUN_DIR/results.json"
RAW_VITEST_EXIT=$?
node __baseline__/verify-no-regression.mjs "$RUN_DIR/results.json"
echo "$RAW_VITEST_EXIT"
```

Expected: the verifier exits 0. The raw suite exit may remain nonzero only for the documented baseline failures. Any verifier failure is a regression and blocks integration.

- [ ] **Step 4: Run static, production, and scope gates**

Run:

```bash
npx eslint open-sse src/sse tests/unit
npm run build
git diff --check 04da36d30..HEAD
git diff --name-status 04da36d30..HEAD
git status --short --branch
```

Expected: ESLint and build exit 0, diff check has no output, scope contains only the planned implementation and test paths plus the two accepted design documents, and the worktree is clean.

- [ ] **Step 5: Perform independent review and report readiness**

Review the final diff against the design. Confirm:

- Every body consumer uses the reader owner and no convenience reader remains in the selected paths.
- 499, 502, and 504 are asserted separately and correct.
- Metadata never crosses alpha, beta, and __all boundaries.
- Only structured provider predicates can yield 404.
- Existing positional TTFT and keepalive calls are unchanged in meaning.
- A terminal emitted by flush suppresses synthetic output, while content prose cannot.
- No untouched behavior was broadened.

Expected: either an approval with no findings or a bounded findings list that returns to the owning task. Do not push, merge, update tracking, or modify upstream state from this plan.

## Plan Self-Review

Coverage is complete. Task 1 owns post-header body reader lifecycle and every error mapping. Task 2 owns model-keyed failure metadata, selection, and all credentialed status projections. Task 3 owns emitted-record parsing and stream timing compatibility. Task 4 verifies the combined requirement surface. All exported names used by a later task are defined in its preceding task, every code-changing task starts with a tests-only red command, and every task has focused, adjacent, static, diff, scope, and commit evidence.
