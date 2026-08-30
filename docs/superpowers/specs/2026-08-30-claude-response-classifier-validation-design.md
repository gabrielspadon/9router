# Claude Response Classifier Validation Design

## Status

Approved recommended adaptation of upstream PR 3319, amended after design
review. Ready for implementation planning.

## Decision

Add one response-only, fail-closed validation policy for Claude Code security
classifier requests. Chat and native-Claude paths validate the final Anthropic
Message. Responses paths first capture a classifier-only, ordered projection of
every raw `output` item and content block before the current lossy client-format
conversion, then validate from that projection. Ordinary requests never enter
the projection and keep their current conversion byte-semantics. Classifier
requests return a canonical decision Message or a specific HTTP 502 error.

Add one adjacent terminal-abort guard in the application account loop. A 499
from the response path returns before account mutation, same-account retry, or
fallback. The existing combo-level 499 guard remains unchanged and continues to
return before its transient delay.

No model, translation, or provider-request behavior belongs to this adaptation.
In particular, it does not copy the upstream PR's model suffix handling or its
older response converters.

## Goal

Claude Code security classification must never treat arbitrary model prose,
tool output, an empty answer, or an ambiguous answer as a valid classifier
decision. A detected classifier response is accepted only when the final
Anthropic Message contains one exact decision, `<block>no</block>` or
`<block>yes</block>`.

The same rule applies across each current non-streaming response family.

1. Responses API SSE converted to an Anthropic Message
2. Chat Completions SSE converted to an Anthropic Message
3. OpenAI Chat Completions JSON converted to an Anthropic Message
4. OpenAI Responses JSON converted to an Anthropic Message
5. Native Claude JSON already shaped as an Anthropic Message

The result must preserve the fork's current JSON-to-Chat and JSON-to-Claude
conversions, both forced-SSE conversions, model routing, request wire behavior,
and every non-499 fallback rule. Classifier validation must see information
that those conversions legitimately discard for ordinary client responses.

## Current Behavior

The current fork already converts non-streaming Responses bodies, Responses
SSE, Chat Completions SSE, and OpenAI JSON into the client format. It also
returns native Claude Messages unchanged. These paths intentionally preserve
custom tools, reasoning blocks, incomplete status, cache-aware usage, JSON
fences, canonical model echoes, and empty-content fallback.

A malformed security classifier answer is currently treated as success. For
example, a forced Responses SSE answer containing `This looks safe to me.` is
converted to an Anthropic text block and returned with HTTP 200.

The Responses SSE branch also loses security-relevant ambiguity before the
final Message exists. `pickAssistantMessageForChatCompletion` selects only the
last non-empty message, the tool collector retains only `function_call` items,
and unknown or custom actionable items do not reach the Anthropic content
array. An earlier conflicting decision, an ignored `custom_tool_call`, or an
unknown output item can therefore disappear before final-Message validation.
The non-streaming Responses JSON bridge similarly concatenates known message
text and ignores unknown output items. Classifier validation must project the
raw `output` array before either conversion.

The application account loop currently sends every failed `handleChatCore`
result, including 499, through `markAccountUnavailable`. That can mutate account
state and retry a canceled request. The combo loop already returns 499 before
error parsing or its five-second transient delay. The adaptation must align the
application loop with that terminal behavior.

The current request path already normalizes generated `[1m]` Claude listing
markers before routing. Real model IDs ending in `-1m` exist in Windsurf and
Devin. Global `-1m` stripping would change those models and is forbidden.

PR 3631 also established the current Codex Fast ordering. The request is fully
translated first, then `applyCodexFastMode` runs once. An explicit client
`service_tier` wins, while an eligible Fast-enabled `gpt-5.6-sol` request gains
`service_tier: "priority"`. Response validation occurs later and must not cross
or alter that boundary.

## Approaches Considered

### Replace the current converters with the upstream PR helper

Rejected. The PR helper predates current Responses body support, custom-tool
mapping, usage filtering, empty-content behavior, canonical echoes, and the two
forced-SSE Claude conversions. Replacing those converters would reopen solved
compatibility defects.

### Validate each provider response format independently

Rejected. Separate Responses, Chat, and Claude scanners would duplicate a
security policy and couple it to provider wire details. Different providers
could then accept different malformed decisions. Validation before conversion
would also risk mutating or rejecting upstream bodies that current conversion
handles correctly.

### Use one leaf policy with a Responses projection and final-Message validation

Selected. Chat and native-Claude paths retain every actionable block in their
final Anthropic Message and can validate that shape directly. Responses paths
need an earlier classifier-only projection because their ordinary conversion
is intentionally lossy. One pure leaf module owns both input adapters and one
shared exact-decision policy. The handlers retain their existing converters,
then use the validated decision only to canonicalize the final Message.

## Architecture

The new module is
`open-sse/handlers/chatCore/claudeClassifier.js`. It imports only fixed Claude
block, role, and Responses item constants from the translator schema. It does
not import a handler, executor, database module, model service, fallback
service, or request translator.

```text
Claude request body
       |
       v
isClaudeClassifierRequest
       |
       +---- false ----> existing conversion, unchanged
       |
       +---- Responses SSE ---> tee raw stream, project every terminal item
       |                            |                    |
       |                            |                    v
       |                            +----> existing SSE converter, unchanged
       |
       +---- Responses JSON --> project raw output before conversion
       |
       +---- Chat/Claude body ---> final Anthropic Message adapter
                                      |
                                      v
                             shared decision validator
                                      |
                   +------------------+------------------+
                   |                                     |
             exact decision                         malformed
                   |                                     |
                   v                                     v
       cloned Message, one text block      ClaudeClassifierValidationError
                                                         |
                                                         v
                                                createErrorResult(502)
```

The module exports these interfaces.

```js
export const CLAUDE_CLASSIFIER_ERROR_MESSAGE =
  "Claude Code classifier returned an invalid decision; expected exactly <block>no</block> or <block>yes</block>.";

export class ClaudeClassifierValidationError extends Error {
  code = "CLAUDE_CLASSIFIER_INVALID_DECISION";
}

export function isClaudeClassifierRequest(body) {}

export async function projectResponsesClassifierStream(body, stream) {}

export function projectResponsesClassifierOutput(body, responseBody) {}

export function validateClaudeClassifierMessage(body, message, projection = null) {}
```

The two projection functions are called only for a Claude-format client whose
request matches the classifier detector. The stream function receives a tee of
the raw actual Responses SSE body before `convertResponsesStreamToJson`. The
body function receives parsed Responses JSON before
`openAIResponsesBodyToChatCompletion`. Both return the same opaque ordered
projection, with one entry for every logical output item and every nested
message or reasoning block. Neither selects the last message, combines text
blocks, drops an item type, nor mutates its input. A non-classifier call returns
`null` without reading a stream or body.

`validateClaudeClassifierMessage` is the handler-facing final operation. For a
Responses path it must use the supplied projection as the authoritative source
of decision entries and actionable ambiguity. It must not rescan the lossy
Message as a substitute. For a Chat or native-Claude path it adapts every final
Anthropic content block into the same internal entry kinds. Both adapters feed
one shared exact-decision validator.

A non-classifier request returns the original `message` reference. A valid
classifier request returns a new top-level Message with a new `content` array.
An invalid classifier request throws only
`ClaudeClassifierValidationError`. The leaf does not mutate the request, the
final Message, its original content array, the projection, or a provider
response.

Handlers catch only the typed classifier error and map it to the fixed 502
contract. Any unrelated exception keeps the handler's existing error path and
message.

The implementation has four production owners and one test owner. There are
three response return seams, three Responses projection capture points, and one
application 499 guard. No converter or combo implementation becomes an owner.

## Classifier Request Detection

Detection is deliberately tied to the current Claude Code wire fingerprint.
The exact, case-sensitive system prefix is a leaf constant.

```text
You are a security monitor for autonomous AI coding agents
```

All detected requests satisfy these common conditions.

1. The body is a non-array object whose `stream` member is absent or exactly
   `false`. Boolean `true`, `null`, strings, numbers, arrays, and objects are
   excluded rather than guessed into a classifier stage.
2. The top-level Claude `system` content begins at code point zero with the
   exact prefix above. The next character must be the end of the text,
   whitespace, a period, or a colon. Matching is not case-folded and leading
   whitespace is not trimmed.
3. The prefix is read only from a top-level system string or from the first
   element of a top-level Claude system array when that element is a Claude
   text block with a string `text` member. Later system blocks, message history,
   user text, tool data, images, and unknown blocks are never scanned. An empty
   array, a non-text first block, or an empty first text does not match.

The stop-sequence member then selects one of the two current Claude Code
classifier stages.

| Stage | Accepted `stop_sequences` shape |
|---|---|
| Stage one | An array containing a string whose outer whitespace trims to exactly `</block>` |
| Stage two | The member is absent or is an empty array |

A present `null`, primitive, non-empty array without the exact sentinel,
substring, case variant, or different closing tag matches neither stage. Extra
stage-one entries may coexist with the exact sentinel because Claude clients
may preserve other stop policy.

The exact prefix is mandatory for both stages. A stop sentinel alone never
activates validation. A generic `security monitor` phrase, a quoted copy of the
prefix later in a normal system prompt, the prefix in a role-system message,
or the prefix in user or tool content also does not activate it. The response
body never participates in request detection.

## Responses Classifier Projection

The projection is classifier-only and preserves classification semantics, not
a new public response format. For JSON it iterates `responseBody.output` in
array order. For SSE it records each terminal output item in event-arrival order
before the existing aggregator can replace an earlier item with the same
`output_index`. Neither projector uses `find`, `filter`, last-message selection,
index-keyed replacement, or text concatenation. Every raw logical output item
produces at least one ordered entry. Every nested message content block and
reasoning summary block produces its own entry. Entries retain their event
ordinal, output index when present, item index, block index, exact type, and
exact string payload when present. Raw response text is never logged or
returned in an error.

The projection classifies entries as follows.

| Responses shape | Projection kind | Validation meaning |
|---|---|---|
| Assistant `message` plus `output_text` with string `text` | `text` | One independent decision candidate |
| `reasoning` plus `summary_text` with string `text` | `thinking` | Non-actionable and discardable |
| `function_call` | `actionable` | Always reject |
| `custom_tool_call` | `actionable` | Always reject |
| `function_call_output`, `custom_tool_call_output`, or `additional_tools` | `actionable` | Always reject |
| Other known tool, call, or call-output item | `actionable` | Always reject |
| Unknown output item or message content type | `unknown` | Always reject |
| Missing, non-array, empty, non-assistant, or malformed shape | `malformed` | Always reject |

A message item is never collapsed into another message item. An empty message
adds a malformed entry. Two messages each carrying a decision remain two text
entries. Two `output_text` blocks in one message remain two text entries. A
valid later decision cannot hide earlier prose, an earlier conflicting
decision, an empty message, or an actionable item.

A reasoning item may have an absent or array-valued `summary`. Every present
summary member must be a `summary_text` object with string text. Other summary
members are unknown and reject. Stable Responses metadata such as item ID,
status, and encrypted reasoning payload may remain attached to a recognized
reasoning item, but it cannot create a decision and is never returned to the
classifier client.

The SSE projector implements the following exact reconciliation contract.

1. It incrementally decodes arbitrarily split UTF-8 chunks and recognizes both
   LF and CRLF frame boundaries. It joins multiple `data:` lines according to
   SSE rules. The explicit `event:` value wins, with the parsed JSON `type` as
   the data-only fallback used by the existing converter.
2. Every `response.output_item.done` frame appends its `item`, even when two
   frames carry the same `output_index`. A missing item, invalid index, or
   malformed done frame appends a malformed entry. Duplicate indexes are never
   overwritten. At the successful terminal frame, done indexes must be unique
   non-negative integers covering zero through the item count minus one.
   Duplicates and gaps make the final projection malformed without changing
   preserved arrival order.
3. `response.completed` and `response.done` are successful terminal frames only
   when `response.status` is absent, `completed`, or `done`.
   `response.incomplete`, `response.failed`, another terminal status, more than
   one terminal frame, or stream EOF without a successful terminal frame adds
   a malformed entry.
4. When a terminal frame has no `response.output`, the ordered done-frame items
   are authoritative. When it has an output array but no done frames, that
   array is authoritative and is projected in array order. When both exist,
   done indexes must be unique contiguous integers and each terminal output at
   that index must be structurally equal to the done-frame item. Any length,
   index, type, content, or payload mismatch adds a malformed entry. Matching
   terminal copies do not create duplicate entries.
5. Recognized Responses delta, `response.output_item.added`, content-part, and
   call-argument frames are transport fragments and never create decision text.
   An unrecognized event that exposes an `item`, `content`, or
   `response.output` adds a malformed entry so an unknown actionable payload
   cannot hide. Other content-free metadata frames and the `[DONE]` sentinel
   are ignored. Invalid JSON in any non-empty data frame adds a malformed entry.

This contract preserves every terminal message, every text or summary block,
every function or custom-tool call, duplicate indexes, conflicting decisions,
and unknown items without double-counting the normal terminal copy. It never
reconstructs a decision from deltas or invents a missing item.

For an actual Responses SSE classifier, the handler tees
`providerResponse.body` exactly once. It consumes one branch with the unchanged
`convertResponsesStreamToJson` and the other with
`projectResponsesClassifierStream` in the same `Promise.all`, preventing either
tee branch from blocking the other. Non-streaming Responses JSON is projected
immediately after JSON parsing. The projection is retained until the final
Anthropic Message exists, then supplied to the shared validator as the
authoritative evidence.

The existing SSE aggregator remains unmodified. No non-classifier request is
teed, buffered, parsed twice, or given a different body reference. A classifier
projection read failure follows the handler's existing upstream stream-failure
path. A successfully read but incomplete, inconsistent, unknown, or malformed
classifier stream reaches the typed classifier validation error and fixed 502.

## Exact Response Contract

For a detected classifier request, the final client object must be an object
with `type: "message"`, `role: "assistant"`, and an array-valued `content`
member. Chat and native-Claude paths derive validator entries directly from
that array. Responses paths derive entries only from the earlier lossless
projection, while still requiring a valid final Message to receive the
canonical decision. In either case, validator entries must contain exactly one
text entry and zero actionable, unknown, or malformed entries.

The text block is valid only when all of these conditions hold.

- Its `text` member is a string.
- After outer whitespace is removed, the complete string is exactly
  `<block>no</block>` or `<block>yes</block>`.
- Matching is case-sensitive.
- No prefix, suffix, prose, second tag, or second text block exists.

Any number of well-formed non-actionable thinking entries may accompany the
decision. In an Anthropic Message, a normal thinking block must have a string
`thinking` member and a redacted-thinking block must have a string `data`
member. In a Responses projection, only recognized reasoning and summary
shapes produce thinking entries. Existing signature or stable reasoning
metadata does not make them actionable. All thinking is discarded from the
client-facing classifier response after the decision is accepted.

Every other shape fails closed. This includes the following cases.

- Missing Message, missing content, non-array content, or malformed blocks
- Empty content, thinking-only content, or whitespace-only decision text
- Prose such as `This looks safe to me.` or `allow`
- Uppercase or mixed-case decision tags
- Text before or after an otherwise valid decision
- Two decision tags in one block or more than one text block
- Any tool-use, image, document, tool-result, server-tool, or unknown block
- A valid decision combined with a tool or other actionable block
- A missing Chat choice or Responses output that does not convert to a Message
- Multiple Responses message items, even when their decision strings agree
- Earlier Responses prose followed by a valid last-message decision
- Conflicting Responses allow and deny decisions in any order
- A valid decision beside `function_call`, `custom_tool_call`, another known
  call item, or an unknown Responses item or content block

On success, outer decision whitespace is removed and the output becomes
exactly one block.

```json
{
  "type": "text",
  "text": "<block>no</block>"
}
```

The returned Message keeps its existing ID, role, model, stop reason, stop
sequence, usage, and other top-level metadata. Only `content` is replaced. On a
Responses path, that final metadata still comes from the existing converter.
Only the canonical decision comes from the projection. The same rule applies
to `<block>yes</block>`.

## Handler Integration and Ordering

At each return seam, only `ClaudeClassifierValidationError` maps to the fixed
classifier 502. The non-streaming handler wraps the validator call locally. In
each existing forced-SSE `catch`, the typed-error branch returns the classifier
502 before the current generic conversion-error branch. Stream I/O, JSON parse,
converter, and unrelated programming errors retain their existing messages.

### True non-streaming responses

`open-sse/handlers/chatCore/nonStreamingHandler.js` keeps every current parser
and converter. It initializes one local projection to `null`. When
`sourceFormat` is Claude, `targetFormat` is Responses, and the request is a
classifier, its unexpected Responses SSE branch tees the raw body and consumes
the existing converter and stream projector concurrently. Its JSON branch
projects the parsed raw `output` before `translateNonStreamingResponse`.
Immediately after `translatedResponse` is assembled, it assigns the result of
`validateClaudeClassifierMessage(body, translatedResponse, projection)`. Chat
Completions JSON and native Claude JSON retain a null projection and validate
every final Anthropic content block instead.

These capture points and the one final validation form one non-streaming return
seam. They cover native Claude JSON, OpenAI Chat JSON, OpenAI Responses JSON,
and unexpected SSE consumed by the non-streaming handler. Final validation runs
before the generic useful-content check so an empty classifier gets the
classifier's specific 502 rather than the unrelated empty-content cooldown
error.

Provider-response logging, `onRequestSuccess`, and usage extraction already
occur before translation. Their ordering and totals remain unchanged. Valid
responses continue through usage filtering, JSON-fence handling, canonical
model echo, request-detail recording, and the existing success return.

### Forced Responses SSE

`open-sse/handlers/chatCore/sseToJsonHandler.js` keeps
`convertResponsesStreamToJson`, current message selection, reasoning blocks,
tool mapping, incomplete-status mapping, cached-token accounting, and all
non-Claude branches. Before consuming an actual Responses stream, it evaluates
the detector only when `sourceFormat` is Claude. A detected classifier tees the
raw body exactly once and awaits the unchanged converter and lossless projector
in one `Promise.all`. An ordinary request calls the converter on the original
body exactly as it does now. After the Claude branch has built `finalResp`, and
before the success return, it validates and reassigns that final Message using
the projection.

Every raw terminal Responses item reaches the projection before aggregation. A
reasoning item can become an allowed thinking entry. A function call,
custom-tool call, unknown item, unknown nested block, duplicate index, extra
message, or conflicting decision remains visible and fails the classifier
contract even if ordinary conversion would drop or overwrite it. A
non-classifier request does not build a projection and follows the existing
conversion exactly.

The Gemini branch that temporarily creates a Responses-shaped body from parsed
Gemini SSE is not an actual Responses source. It is not teed or projected and
continues through its current conversion plus final Anthropic Message
validation. This task does not create a second Gemini wire parser.

### Forced Chat Completions SSE

The same handler keeps `parseSSEToOpenAIResponse`, reasoning and tool-delta
assembly, usage reattachment, JSON-fence handling, and the existing
OpenAI-to-Claude conversion. After that conversion has built `finalBody`, and
before success is returned, it validates and reassigns the final Message.

No validator call is added to the streaming response handler. A request with
`stream: true` is outside this classifier seam and follows the current stream
path unchanged.

### Terminal 499 propagation

`src/sse/handlers/chat.js` adds one guard immediately after an unsuccessful
`handleChatCore` result and before request-buffer replay detection or
`markAccountUnavailable`.

```js
if (result.status === 499) return result.response;
```

The guard does not inspect classifier content and does not change any other
status. It prevents a caller cancellation from clearing or setting account
state, incrementing the per-connection failure counter, retrying the same
account, excluding a connection, or selecting another account. The existing
`handleComboChat` guard already returns 499 before error parsing, transient
cooldown, model fallback, and timer creation. No combo production edit is
needed.

## Error and Fallback Semantics

All malformed classifier shapes throw the same typed error with the same fixed
message. The three handler sites map that error through
`createErrorResult(HTTP_STATUS.BAD_GATEWAY, CLAUDE_CLASSIFIER_ERROR_MESSAGE)`.
The client receives HTTP 502 and the existing error envelope.

```json
{
  "error": {
    "message": "Claude Code classifier returned an invalid decision; expected exactly <block>no</block> or <block>yes</block>.",
    "type": "server_error",
    "code": "bad_gateway"
  }
}
```

The invalid model output is not included in the error. No allow or deny answer
is synthesized. The validator adds no retry count, delay, cooldown, account
mutation, or combo rule.

Existing fallback owns the 502 after it leaves the response handler. Account
selection may retry or rotate according to its current 502 policy. A fallback
combo sees the same 502 and may try its next model under
`checkFallbackError`. Existing transient delay behavior remains unchanged.
Existing upstream 401, 429, 503, and 504 handling stays unchanged and is never
converted into a classifier answer.

Caller abort status 499 is a separate terminal contract. The application
account loop returns it before `markAccountUnavailable`, failure-counter
updates, retries, exclusions, or another credential lookup. The combo loop
returns it before `checkFallbackError`, the transient five-second delay, or the
next model. A 499 produces zero account writes, model locks, cooldowns,
fallback attempts, retry timers, and synthesized classifier decisions.

An upstream HTTP 200 can still incur usage even when its classifier decision
is invalid. Existing usage recording and request-success callback ordering are
therefore retained. This adaptation changes client semantic success, not the
fact that the provider completed and billed a request.

## Request and Routing Invariants

The implementation must not edit or import classifier policy into any request
path. These invariants remain exact.

- `src/lib/claudeCompat.js` keeps route-aware `[1m]` normalization.
- Exact aliases, combos, registered names, and real Windsurf and Devin `-1m`
  IDs remain unchanged.
- `open-sse/handlers/chatCore.js`, model services, capability lookup, combo
  lookup, and request translators do not change. The only application-handler
  change is the terminal 499 return in `src/sse/handlers/chat.js`.
- `applyCodexFastMode` remains after passthrough or translation and before
  executor dispatch.
- A Fast-enabled Codex Sol request without a client tier still sends
  `service_tier: "priority"`.
- Explicit client `service_tier: "default"` and `service_tier: "priority"`
  remain exact and take precedence over the automatic Fast tier.
- Classifier detection occurs only in response handlers after the executor has
  returned. Projection occurs before lossy Responses conversion, and validation
  occurs only after a final Claude Message exists.
- Tools, request messages, system prompts, model names, canonical model echoes,
  context metadata, and provider request bodies are not rewritten by this
  seam.

## Strict TDD Strategy

All new coverage lives in
`tests/unit/claude-auto-mode-classifier.test.js`. Production changes begin only
after the first focused RED proves the current gap.

### First RED

Build a forced Responses SSE classifier fixture whose output text is
`This looks safe to me.`. Call the real `handleForcedSSEToJson` path and assert
HTTP 502 plus the exact classifier error. Against the frozen base, the test
must fail because the path returns HTTP 200. Save that receipt before adding
production code.

Add the pure detector, Responses projection, shared validator, and only the
Responses SSE capture and final return site. Rerun the same test and the full
projection matrix to GREEN before adding another response path.

### Pure detector and validator matrix

Tests must prove all detector conjunctions and near misses.

1. Use request-shaped fixtures for both current Claude Code calls. Detect the
   exact prefix at code point zero in a top-level system string and top-level
   system text-block array.
2. Detect the real stage-one shape with `stream: false` or missing plus an
   exact `</block>` stop entry, including outer sentinel whitespace and
   additional entries.
3. Detect the real stage-two shape with `stream: false` or missing plus an
   absent `stop_sequences` member. Cover an empty array as the equivalent
   accepted serialization.
4. Reject `stream: true`, `null`, strings, numbers, arrays, and objects.
5. Reject leading whitespace, changed case, generic `security monitor` text,
   prefix continuations without a boundary, non-empty wrong stop arrays, and a
   present null stop member.
6. Ignore the exact prefix inside role-system messages, user, assistant, tool,
   tool-result, image, and unknown blocks.
7. Prove a stop sentinel without the exact prefix does not detect either stage.
8. Prove detection does not mutate a deeply frozen request.
9. Run bypass fixtures containing ordinary assistant prose, tool-use blocks,
   and the exact prefix quoted later in a normal system prompt. Even with a
   stop sentinel, they must retain their current successful response unchanged.

Tests must then cover both exact decisions and every rejection class in the
response contract. Include thinking plus one exact decision, redacted thinking
plus one exact decision, malformed thinking, empty output, multiple text
blocks, tool use, decision plus tool use, unknown blocks, changed case,
prefixes, suffixes, and multiple tags. Assert valid canonicalization uses new
Message and content objects while the original deeply frozen Message remains
unchanged. Assert a non-classifier Message is returned by identity.

### Responses projection RED matrix

Before adding projection support, run every case below through the real forced
Responses SSE handler. Each malformed or ambiguous case must assert the fixed
502. Current conversion returns 200 for at least the last-selected decision,
ignored custom-tool, and ignored unknown-item cases, providing load-bearing RED
receipts.

| Ordered Responses `output` | Expected result |
|---|---|
| One assistant message with one exact allow text | Canonical allow Message |
| One assistant message with one exact deny text | Canonical deny Message |
| Reasoning item, then one exact decision | Canonical decision with reasoning discarded |
| Earlier prose message, then valid decision message | 502 |
| Earlier allow message, then deny message | 502 |
| Earlier deny message, then allow message | 502 |
| Two identical valid decision messages | 502 |
| One message with two decision text blocks | 502 |
| Empty message, then valid decision message | 502 |
| Valid decision plus `function_call` in either order | 502 |
| Valid decision plus `custom_tool_call` in either order | 502 |
| Valid decision plus `function_call_output` or `custom_tool_call_output` | 502 |
| Valid decision plus `additional_tools` or another known call item | 502 |
| Valid decision plus unknown output item | 502 |
| Valid decision plus unknown message content block | 502 |
| Valid decision plus malformed reasoning summary | 502 |
| Reasoning only, empty output, missing output, or non-array output | 502 |

Repeat the load-bearing conflicting-message, function-call, custom-tool,
call-output, additional-tools, unknown-item, and unknown-content cases through
non-streaming Responses JSON. Assert projection entry order and count directly
in pure tests so an implementation cannot pass by concatenating or selecting
output. For `N` output items, every item must produce at least one entry. For a
message with `M` content blocks, all `M` blocks must remain distinct. Normal
non-classifier fixtures must prove the projection function is not called and
current conversion remains deeply equal.

The forced Responses SSE matrix uses raw frames rather than an already
aggregated body. It adds these transport-specific RED cases.

| Raw SSE fixture | Expected result |
|---|---|
| One valid done item plus one successful terminal frame | Canonical decision |
| Valid done item in arbitrarily split UTF-8 chunks using LF | Canonical decision |
| Valid data-only frames using CRLF and no `event:` line | Canonical decision |
| Matching done items and terminal `response.output` copies | Canonical decision, one entry per logical item |
| Terminal `response.output` only with one exact decision | Canonical decision |
| Allow and deny done frames with distinct indexes | 502 |
| Allow then deny done frames with the same index | 502, neither frame overwritten |
| Valid decision done frame plus custom-tool done frame | 502 |
| Valid decision done frame plus function-call done frame | 502 |
| Valid decision done frame plus unknown-item done frame | 502 |
| Valid decision done frame plus unknown nested block | 502 |
| Done items and terminal output differ in length, index, type, or payload | 502 |
| Duplicate terminal, incomplete, failed, or EOF before terminal | 502 |
| Missing item, non-integer index, hidden item on an unknown frame, or malformed JSON frame | 502 |

Assert the pure stream projector preserves done-frame arrival order and every
duplicate index. Assert the conversion branch still produces its existing
body from the same teed bytes. The fragmented LF, data-only CRLF, and matching
terminal-copy success cases prevent the fail-closed parser from rejecting a
normal exact classifier response. The ambiguous same-index and ignored-item
cases are load-bearing RED because the current index-keyed aggregator returns
only its surviving normal message.

### Path-specific RED and GREEN

Before each missing handler hook is implemented, add and run its malformed
fixture to produce a separate RED receipt. Then add the minimum call site and
make it GREEN.

1. Chat Completions SSE with malformed prose
2. OpenAI Chat Completions JSON with malformed prose
3. OpenAI Responses JSON with malformed prose
4. Native Claude JSON with malformed prose

Each family also gets valid allow and deny coverage. The success assertion is
an Anthropic Message with exactly one canonical text block and preserved
top-level metadata. Stable non-classifier fixtures for Responses SSE, Chat
SSE, both OpenAI JSON shapes, and native Claude JSON must remain deeply equal
to current behavior. Fixed IDs and timestamps remove nondeterminism from those
comparisons.

### Fallback and Fast integration

Use the real `handleComboChat` with fake timers and handler-backed responses.
Prove a first-model classifier 502 advances to a second model, a valid first
decision prevents fallback, and a 499 response is terminal. For 499, assert the
second model is never called, `checkFallbackError`-owned behavior is not
observed, no fake-timer task is created or advanced, and the original 499
Response is returned by identity. Preserve current 401, 429, 503, and 504
behavior without synthesizing a decision.

Use a mocked `handleChatCore` around the real exported application
`handleChat`. Make the first account return 499 and assert
`markAccountUnavailable`, `clearAccountError`, and every persistence or lock
mock have zero calls. Assert `handleChatCore` and credential selection each run
once, the same account is not retried, no second account is selected, failure
counters cannot drive exclusion, and the original 499 body and status reach the
client. A neighboring 502 case must still call `markAccountUnavailable` and
retain existing retry or fallback behavior. This is the RED for the new
application guard because current code calls `markAccountUnavailable` on 499.

Use a mocked executor around the real `handleChatCore` request ordering. A
Claude classifier request routed to Codex `gpt-5.6-sol` must reach the executor
with `service_tier: "priority"` when Fast is enabled, then fail with the
classifier 502 when the executor returns malformed Responses SSE. Parameterize
explicit `default` and `priority` tiers and assert they reach the executor
unchanged before the same later validation. This test observes ordering but
does not edit the request path.

## Ownership

Implementation ownership is limited to four production paths and one test
path.

```text
open-sse/handlers/chatCore/claudeClassifier.js
open-sse/handlers/chatCore/nonStreamingHandler.js
open-sse/handlers/chatCore/sseToJsonHandler.js
src/sse/handlers/chat.js
tests/unit/claude-auto-mode-classifier.test.js
```

The two existing converter functions remain in their current handlers. Moving
or deduplicating them is outside this task because
`nonStreamingHandler.js` imports the SSE parser and a converter refactor would
create a separate circular-import and regression review.

The application handler ownership is exactly one early 499 return. Existing
tests may be run but are not edited. `open-sse/services/combo.js` is verified
through its public function but does not change because its 499 guard already
precedes delay and fallback. If implementation requires a sixth path, request
model change, converter replacement, or combo edit, stop and refresh the
design.

## Exclusions

- No cherry-pick, merge, or raw application of PR 3319
- No `-1m` or `[1m]` suffix logic
- No model, alias, provider registry, capability, combo, or routing change
- No edit to `open-sse/handlers/chatCore.js`
- No application-handler edit beyond returning 499 before account mutation
- No edit to `open-sse/config/codexFastMode.js`, executor request bodies, or
  service-tier policy
- No request translation, system prompt, context metadata, tool, usage,
  canonical echo, JSON-fence, or empty-content policy change
- No streaming classifier validation
- No edit to `open-sse/services/combo.js`, account fallback rules, cooldown
  durations, account persistence, or lock construction
- No persistence, UI, dependency, lockfile, tracking, or baseline change
- No refactor of current OpenAI, Responses, or Claude converters
- No response-text logging in validation errors

## Verification Gates

Implementation is complete only with fresh receipts for every applicable
gate.

1. Record the isolated implementation base and clean status. Refresh the
   design if either response handler moved after `bbf75669a`.
2. Preserve separate first-RED and path-specific RED receipts before each
   production hook.
3. Run the dedicated classifier module with zero unexpected skips.
4. Run the current Claude conversion, compatibility, request replay, timeout,
   Fast, and combo adjacency set.
5. Run syntax checks and changed-file ESLint.
6. Run the full Vitest suite and the repository no-regression verifier. Treat
   catalogued failures as baseline, never as new passes.
7. Run the production build.
8. Run `git diff --check` and confirm the diff contains only the five owned
   paths. Confirm `src/sse/handlers/chat.js` contains only the 499 guard and the
   diff has no suffix, provider-request, Fast, model, capability, combo,
   persistence, UI, tracking, or baseline change.
9. Independently review the complete branch for false positives, missing
   native or translated paths, mutation, and fallback regressions.

The focused command is run from `tests/`.

```bash
npx vitest run --config vitest.config.js \
  unit/claude-auto-mode-classifier.test.js
```

The adjacency command is also run from `tests/`.

```bash
npx vitest run --config vitest.config.js \
  unit/claude-auto-mode-classifier.test.js \
  unit/openai-responses-nonstream.test.js \
  unit/claude-compat-layer.test.js \
  unit/chat-request-replay.test.js \
  unit/chat-connect-timeout-propagation.test.js \
  unit/codex-fast-capacity.test.js \
  unit/combo-routing.test.js \
  unit/combo-autoswitch.test.js
```

Repository checks run from the worktree root.

```bash
node --check open-sse/handlers/chatCore/claudeClassifier.js
node --check open-sse/handlers/chatCore/nonStreamingHandler.js
node --check open-sse/handlers/chatCore/sseToJsonHandler.js
node --check src/sse/handlers/chat.js
npx eslint \
  open-sse/handlers/chatCore/claudeClassifier.js \
  open-sse/handlers/chatCore/nonStreamingHandler.js \
  open-sse/handlers/chatCore/sseToJsonHandler.js \
  src/sse/handlers/chat.js \
  tests/unit/claude-auto-mode-classifier.test.js
npm run build
```

The full-suite receipt is captured as JSON and checked through the committed
baseline verifier.

```bash
(cd tests && npx vitest run --reporter=json \
  --outputFile=/tmp/task7-pr3319-vitest.json)
node tests/__baseline__/verify-no-regression.mjs \
  /tmp/task7-pr3319-vitest.json
git diff --check
```

## Acceptance Boundary

This adaptation is complete only when every detected non-streaming Claude
classifier path returns one exact canonical decision or the specific 502,
ordinary traffic is unchanged, fallback receives the 502, and captured
executor requests prove Fast and explicit service tiers are untouched.

Completion does not include global context-suffix support or any other PR 3319
hunk.
