# Joint Response-Safety Adaptation Design

## Decision

Adapt the useful intent of upstream PRs #3220, #3221, and #3222 as one deliberately designed batch after the PR3632 response-header deadline work is integrated. Do not merge, cherry-pick, or mechanically port any upstream commit.

The batch has three independently reviewable implementation phases.

1. A reader-owned deadline for non-streaming response bodies.
2. Per-model account-failure metadata and client-status projection.
3. Typed parsing of client-emitted SSE terminal records.

The implementation base must include PR3632. It supplies the established header-deadline and stream timing contracts that this design extends. It does not own response bodies.

## Recommended Approach

Three options were examined.

| Option | Result |
| --- | --- |
| Port each upstream PR independently | Rejected. It repeats the locked-stream cancellation bug, uses a flat last-error field for several model locks, and passes a terminal tracker into the PR3632 TTFT positional slot. |
| One generic response wrapper | Rejected. A wrapper that calls Response.json() or Response.text() cannot cancel the reader those methods lock. It also makes ordinary streaming behavior part of a non-streaming fix. |
| Reader ownership, keyed lock metadata, and emitted-record observation | Selected. Each lifecycle owner controls the resource it must close, each model lock owns its diagnostic state, and terminal detection examines structured output rather than prose. |

The selected approach confines each change to a distinct safety boundary and lets a reviewer accept one phase without accepting the others.

## Scope and Non-Goals

This batch protects the chat and Responses non-streaming body consumers, credential selection diagnostics, and client-facing SSE completion semantics.

It does not:

- Change the PR3632 response-header deadline primitive, UI settings, or ConnectTimeoutError status contract.
- Apply a deadline to arbitrary media downloads, provider polling, uploads, or successful client streaming bodies.
- Add a global text classifier for model errors.
- Replace provider-specific error rules, account strategy, quota policy, OAuth refresh flow, or database schema.
- Synthesize terminals for formats that lack an unambiguous typed terminal.
- Change emitted bytes for healthy legacy streams, including their existing TTFT, stall, and keepalive timing.

## Phase 1: Non-Streaming Body Ownership

### Contract

Add RESPONSE_BODY_TIMEOUT_MS to open-sse/config/runtimeConfig.js. It uses the existing validated environment-number convention, defaults to 300000 milliseconds, and has no zero or negative opt-out. This is intentionally independent from PR3632's response-header deadline. A large buffered completion can legitimately take longer than its headers, but it may not hold the client socket forever.

Add open-sse/utils/bodyTimeout.js with these public concepts.

| Interface | Contract |
| --- | --- |
| BodyReadTimeoutError | Typed post-header timeout. Its stable code is UPSTREAM_RESPONSE_BODY_TIMEOUT and it includes the selected timeout in milliseconds. |
| isBodyReadTimeoutError(error) | Identifies only that typed error. It does not infer a timeout from arbitrary messages. |
| consumeResponseBodyWithDeadline({ body, signal, timeoutMs, consume }) | Acquires the one real ReadableStreamDefaultReader, passes that reader to consume, and owns deadline, caller-abort, cancellation, lock release, and first-terminal-cause selection. |
| readResponseTextWithDeadline and readResponseJsonWithDeadline | Small consumers built on the owner. They decode bytes and parse JSON without calling Response.text() or Response.json(). |

convertResponsesStreamToJson accepts an optional already-owned reader. Its existing stream-only form remains supported for independent callers and tests. The Phase 1 callers use the reader form through the owner, so the converter never acquires a second reader in that path.

The owner records one terminal source: normal completion, caller cancellation, body deadline, or reader error. The first source wins. On deadline or caller cancellation it calls reader.cancel(reason) before releasing the lock. A late read completion cannot turn a recorded deadline into success, and cleanup is idempotent. The helper never calls response.body.cancel() after a convenience method has already locked the stream.

### Consumers

Apply the owner only where the response has already been classified as a non-streaming body.

| Consumer | Body form |
| --- | --- |
| open-sse/handlers/chatCore/nonStreamingHandler.js | Ordinary JSON, forced Chat-Completions SSE text, and Responses SSE conversion. |
| open-sse/handlers/chatCore/sseToJsonHandler.js | Forced Chat-Completions SSE text, Gemini SSE text, and Responses SSE conversion. |
| open-sse/handlers/responsesHandler.js | The /v1/responses non-streaming conversion of a returned SSE body. |

The shared helper receives the request signal that remains live after PR3632 clears its header timer. This preserves an actual client cancellation during a body read.

### Failure Mapping

The distinction is intentional and is part of the public contract.

| Cause | Client status | Account fallback state |
| --- | --- | --- |
| Caller signal aborts before or during body consumption | 499 | None. The selected account is not marked unavailable and no fallback attempt starts. |
| PR3632 typed response-header deadline, ConnectTimeoutError | 502 | Existing PR3632 behavior, unchanged. |
| BodyReadTimeoutError after headers | 504 | One ordinary failed attempt. The selected account follows the existing fallback policy exactly once. |
| Malformed JSON, malformed SSE, or malformed Responses payload | 502 | Existing failed-attempt handling only. |
| Unrelated reader or decode error | 502 | Existing failed-attempt handling only. |

The 504 is deliberately not flattened into the 502 header contract. The gateway received a valid response head but did not receive a completed body. The implementation must preserve the original status internally for account fallback and never label a caller cancellation as an upstream failure.

### Ownership and Race Guarantees

- Exactly one code path owns the actual body reader.
- A deadline cancels that actual reader before its lock is released.
- Caller cancellation wins if observed first. It retains the caller reason and reaches the existing 499 path.
- Deadline wins if observed first. A concurrent late chunk or EOF cannot convert it to a success.
- Normal EOF clears timer and abort listeners before returning parsed data.
- A converter given an owned reader does not release a reader it did not acquire. The outer owner releases it exactly once.
- No success callback, usage write, or account-error clear runs after a body deadline or caller cancellation.

### Strict TDD Matrix

Start with the red tests. Each row must fail against the immediately preceding state and pass only after the smallest owning change.

| Test location | Red condition | Required green assertion |
| --- | --- | --- |
| tests/unit/body-read-deadline.test.js | JSON and UTF-8 text reader helpers do not exist | Healthy bodies decode exactly, timer and listeners clear, and one real reader is released. |
| tests/unit/body-read-deadline.test.js | A controlled reader stalls after headers | The result is BodyReadTimeoutError, reader.cancel receives that reason once, and the lock releases once. |
| tests/unit/body-read-deadline.test.js | Caller abort races a pending read | The original caller reason wins, no timeout error is constructed, and no later success escapes. |
| tests/unit/non-stream-body-timeout.test.js | Ordinary JSON, Chat SSE, Gemini SSE, and Responses SSE still use convenience body readers | Each healthy path completes with its current payload and each stalled path projects 504. |
| tests/unit/non-stream-body-timeout.test.js | Malformed payload and caller abort cases lack separation | Malformed payloads are 502, caller aborts are 499, and only the 504 case invokes the normal single account-fallback transition. |
| tests/unit/stream-to-json-converter.test.js and tests/unit/responses-stream-to-json-usage.test.js | The converter cannot consume a supplied reader | Existing direct-stream callers remain byte and usage compatible while the owned-reader path preserves the same response object. |

## Phase 2: Per-Model Failure State and Client Projection

### State Model

Keep the existing expiry field as the routing key.

modelLock_<model-or-__all> = ISO-8601 expiry

Add a companion, independently merged metadata field for the same key.

modelFailure_<model-or-__all> = { status, message, until, resetsAt }

message is the existing describeProviderError sanitized and bounded value. until duplicates the lock expiry for integrity checks. resetsAt is an ISO value or null and preserves a provider-supplied precise reset when one exists. The companion name deliberately does not start with modelLock_, so existing expiry-only scans cannot misread a metadata object as a date.

Both fields are top-level connection data fields. updateProviderConnection already transactionally merges top-level keys, so simultaneous alpha and beta failures write different keys rather than replacing a shared metadata map. No migration is needed because connection data is JSON and missing legacy metadata has a defined safe behavior.

Add helpers in open-sse/services/accountFallback.js that construct, read, and clear the field pair. getActiveModelFailure(connection, model) selects an active account-wide __all lock first, then the exact requested-model lock. It never reads a different model's flat lastError or metadata. A legacy active expiry with no matching metadata yields a generic unavailable message and no stored status.

getEarliestModelLockUntil(connection, model) gains an optional model argument. With no model it remains the existing UI-wide earliest-active-lock query. With a model it reads only the selected account-wide-or-exact lock.

markAccountUnavailable writes the expiry and companion together in one merge. clearAccountError clears the exact model pair plus expired pairs, and does not clear another active model's pair. The present account-wide success semantics remain unchanged, but every cleared lock removes its matching metadata too.

### Credential Result and Status Contract

When all available accounts are locked for model M, getProviderCredentials chooses the connection with the earliest selected lock for M, with account-wide precedence inside each connection. It returns:

| Field | Meaning |
| --- | --- |
| retryAfter and retryAfterHuman | The selected lock expiry only. |
| lastError | The safe message from that same selected lock, or null for legacy metadata. |
| lastErrorCode | The raw provider status from that same selected lock, or null. |
| clientErrorStatus | A separately projected status for the client. |

The raw provider status remains the input to account fallback. Client status is projected only at existing allRateLimited response sites in chat, embeddings, fetch, image generation, JSON proxy, search, STT, TTS, and video generation. No handler may recompute it from another connection's state.

Project 404 only through a provider-verified unknown-model classifier. The classifier is a provider-keyed table of exact status, code, and structured payload predicates. It receives provider, requested model, raw status, and parsed error payload. It returns true only when that provider's documented or observed unknown-model response identifies the requested model. Generic prose such as ModelError, unknown model, or not supported is insufficient.

If the classifier is not positive, preserve the raw client class. A non-model 401 remains 401. Rejected request parameters follow the existing no-fallback rules and do not create a model lock. Client responses must never include an error, status, reset, model name, connection name, or account detail owned by a different model lock.

### Concurrency Guarantees

- Alpha and beta can be locked concurrently on one connection without sharing status, reason, expiry, or reset metadata.
- A request for alpha may observe only alpha or __all, never beta.
- An active __all lock takes precedence over an exact lock for the same request and exposes only its own metadata.
- Metadata is selected from the same connection and same lock that supplies retryAfter.
- A legacy expiry without metadata is safe but non-diagnostic. It cannot borrow a flat connection error.
- Client-status projection does not alter the raw upstream result used to make account rotation decisions.

### Strict TDD Matrix

| Test location | Red condition | Required green assertion |
| --- | --- | --- |
| tests/unit/model-lock-metadata.test.js | Alpha and beta share lastError and errorCode | Concurrent locks retain distinct expiry, reason, status, and reset metadata through independent merge writes. |
| tests/unit/model-lock-metadata.test.js | Selection uses all model locks or a first connection | Alpha reads alpha only, beta reads beta only, and __all has precedence. |
| tests/unit/model-lock-metadata.test.js | Cleanup removes only expiry fields | Exact successful-model and expired cleanup remove the matching metadata while preserving another active model pair. |
| tests/unit/model-lock-metadata.test.js | Legacy lock data can read a newer flat error | A legacy lock yields generic unavailable state with null code and leaks no unrelated detail. |
| tests/unit/client-model-error-status.test.js | String matching can turn arbitrary errors into 404 | A positively identified provider/model failure is 404, a non-model 401 stays 401, and invalid request parameters create no lock. |
| tests/unit/client-model-error-status.test.js | All locked handler responses ignore projection | Every credentialed handler consumes clientErrorStatus and never exposes another model or account detail. |

## Phase 3: Typed Emitted-SSE Terminal Parsing

### Stream Interface

PR3632 already establishes this positional timing contract for pipeWithDisconnect.

onAbortTerminal, stallTimeoutMs, ttftTimeoutMs, keepaliveMs

It must remain valid for every existing caller and test. New terminal behavior uses a normalized options object rather than inserting a tracker into those positions. The function accepts either the legacy positional contract or an object with exactly onAbortTerminal, stallTimeoutMs, ttftTimeoutMs, keepaliveMs, and terminalObserver. New production code uses the object. Legacy calls preserve their current meaning byte for byte.

buildTransformStream returns both its transform and the format that reaches the client. The terminal observer is created from that emitted format, not the provider target format. A translated Responses provider can emit OpenAI or Claude frames, and a parser aimed at the provider format would inspect events the client never sees.

Add open-sse/utils/streamTerminal.js with a bounded incremental SSE record observer. It uses one TextDecoder with streaming decode and buffers until a complete SSE event record ends in a blank line. It parses event and joined data lines, JSON-decodes data when required, and never scans arbitrary text for terminal words. It observes transformed client bytes after translator flushes, without changing those bytes.

| Emitted client format | Typed terminal proof | Synthesized incomplete terminal |
| --- | --- | --- |
| OpenAI Chat Completions | Data sentinel [DONE], or a decoded choice with non-null finish_reason | Existing OpenAI-compatible error record followed by [DONE]. |
| Claude Messages | Decoded payload type exactly message_stop | Existing Claude event:error API-error record. |
| OpenAI Responses | Event or decoded payload type exactly response.completed, response.done, response.failed, or response.incomplete | Existing response.failed plus [DONE] builder. |
| Every other format | No observer | No new terminal is synthesized. |

On transformed-stream EOF or network reset without typed terminal proof, emit one synthesized terminal then close through the abnormal completion path. If a translator flush emits a typed terminal, the observer sees it before EOF and does nothing. If the client cancels, cancel() aborts upstream but emits no synthetic upstream error. A single terminal-emitted guard covers timeout, network-error, EOF, and both current Responses helper paths.

### Parser and Lifecycle Guarantees

- Literal message_stop, response.completed, or [DONE] inside text content is never terminal proof.
- Terminal records split across arbitrary byte chunks, including a split UTF-8 code point or CRLF delimiter, are recognized only after their complete record exists.
- Output already emitted by the translator is retained. The observer is post-transform and cannot discard a flushed real terminal.
- Healthy streams get no added frame, error callback, timing change, or second [DONE].
- An incomplete supported stream receives exactly one synthetic terminal.
- Existing upstream-byte TTFT and stall watches, and outbound keepalive placement, retain the PR3632 values exactly.

### Strict TDD Matrix

| Test location | Red condition | Required green assertion |
| --- | --- | --- |
| tests/unit/sse-terminal-observer.test.js | Observer does not exist | OpenAI, Claude, and Responses real terminals split across chunks are recognized after complete record assembly. |
| tests/unit/sse-terminal-observer.test.js | Prose scanning accepts terminal words | A Claude content delta containing literal message_stop and a Responses text delta containing response.completed do not suppress a later synthetic failure. |
| tests/unit/stream-terminal-contract.test.js | EOF is always normal completion | Partial drop and network reset synthesize one format-correct terminal, while client cancellation synthesizes none. |
| tests/unit/stream-terminal-contract.test.js | Translation flush is not observed | A translator-flushed terminal reaches the client without a synthetic duplicate. |
| tests/unit/stream-terminal-contract.test.js | Options normalization changes timer positions | Legacy positional calls retain their prior TTFT and keepalive values, while the new object carries the same values plus an observer. |
| tests/unit/responses-abort-terminal.test.js, tests/unit/sse-keepalive.test.js, tests/unit/ttft-watchdog.test.js, and tests/unit/stream-newline-scanner.test.js | Existing stream contracts regress | Current Responses abort bytes, keepalive behavior, TTFT watchdog behavior, and framing preservation remain unchanged. |

## Delivery and Review Boundaries

Implement and review the phases in order. Phase 1 and Phase 3 must remain separate commits because one owns buffered-body readers and the other owns post-transform stream completion. Phase 2 may be reviewed independently once its handler projection matrix is complete.

Before integration, prove all new focused tests, their named adjacent regressions, the repository no-regression verifier, and a fresh production build on the final combined branch. A raw full Vitest failure remains evidence to classify, not a passing result.

## Design Self-Review

This design contains no implementation, plan, missing section, or unresolved user decision. It chooses one body timeout default and full status mapping, names the owned interfaces, confines every consumer, distinguishes raw and client statuses, preserves legacy timing calls, and gives each phase a failing-first test matrix. The three phases share the response-safety objective but have no shared code-write requirement, so they remain separable at implementation and review time.
