# Claude Response Classifier Validation Design

## Status

Approved recommended adaptation of upstream PR 3319. Ready for implementation
planning.

## Decision

Add one response-only, fail-closed validation seam for Claude Code security
classifier requests. Every owned response path first keeps its current provider
parsing and client-format conversion. If the client format is Claude, the path
then passes the final Anthropic Message and the request body to one pure leaf
module. Ordinary requests pass through unchanged. Classifier requests return a
canonical decision Message or a specific HTTP 502 error.

No request-side behavior belongs to this adaptation. In particular, it does not
copy the upstream PR's model suffix handling or its older response converters.

## Goal

Claude Code security classification must never treat arbitrary model prose,
tool output, an empty answer, or an ambiguous answer as a valid classifier
decision. A detected classifier response is accepted only when the final
Anthropic Message contains one exact decision, `<block>no</block>` or
`<block>yes</block>`.

The same rule applies after each current non-streaming response family.

1. Responses API SSE converted to an Anthropic Message
2. Chat Completions SSE converted to an Anthropic Message
3. OpenAI Chat Completions JSON converted to an Anthropic Message
4. OpenAI Responses JSON converted to an Anthropic Message
5. Native Claude JSON already shaped as an Anthropic Message

The result must preserve the fork's current JSON-to-Chat and JSON-to-Claude
conversions, both forced-SSE conversions, model routing, fallback, and request
wire behavior.

## Current Behavior

The current fork already converts non-streaming Responses bodies, Responses
SSE, Chat Completions SSE, and OpenAI JSON into the client format. It also
returns native Claude Messages unchanged. These paths intentionally preserve
custom tools, reasoning blocks, incomplete status, cache-aware usage, JSON
fences, canonical model echoes, and empty-content fallback.

A malformed security classifier answer is currently treated as success. For
example, a forced Responses SSE answer containing `This looks safe to me.` is
converted to an Anthropic text block and returned with HTTP 200. That is the
only unsuperseded behavior from PR 3319 selected for adaptation.

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

### Validate the final Anthropic Message through one leaf module

Selected. Every owned path already converges on an Anthropic Message for a
Claude client. A pure leaf module can detect the request, validate one final
shape, canonicalize the decision without mutating caller data, and expose one
typed failure. The handlers gain only narrow call sites after conversion.

## Architecture

The new module is
`open-sse/handlers/chatCore/claudeClassifier.js`. It imports only fixed Claude
block and role constants from the translator schema. It does not import a
handler, executor, database module, model service, fallback service, or request
translator.

```text
Claude request body
       |
       v
isClaudeClassifierRequest
       |
       +---- false ----> return final Message unchanged
       |
       v
validateClaudeClassifierMessage
       |
       +---- exact decision ----> cloned Message with one canonical text block
       |
       +---- malformed ----------> ClaudeClassifierValidationError
                                      |
                                      v
                              existing createErrorResult(502)
```

The module exports these interfaces.

```js
export const CLAUDE_CLASSIFIER_ERROR_MESSAGE =
  "Claude Code classifier returned an invalid decision; expected exactly <block>no</block> or <block>yes</block>.";

export class ClaudeClassifierValidationError extends Error {
  code = "CLAUDE_CLASSIFIER_INVALID_DECISION";
}

export function isClaudeClassifierRequest(body) {}

export function validateClaudeClassifierMessage(body, message) {}
```

`validateClaudeClassifierMessage` is the handler-facing operation. A
non-classifier request returns the original `message` reference. A valid
classifier request returns a new top-level Message with a new `content` array.
An invalid classifier request throws only
`ClaudeClassifierValidationError`. The validator does not mutate the request,
the final Message, its original content array, or any provider response.

Handlers catch only the typed classifier error and map it to the fixed 502
contract. Any unrelated exception keeps the handler's existing error path and
message.

## Classifier Request Detection

Detection is deliberately conjunctive. All three signals must be present.

1. The body is a non-array object whose `stream` member is not exactly `true`.
   Missing, `false`, and `null` remain non-streaming under the current routing
   convention. Only the boolean value `true` disables classifier detection.
2. `stop_sequences` is an array containing a string whose outer whitespace
   trims to exactly `</block>`. Other entries may coexist, but substrings,
   case variants, non-string values, and other closing tags do not match.
3. System text contains the case-insensitive phrase `security monitor`, with
   one or more whitespace characters between the words and word boundaries on
   both sides.

System text is collected from two existing Claude-compatible shapes.

- `body.system` when it is a string or an array of strings and Claude text
  blocks
- `content` from `body.messages` entries whose role is exactly `system`, using
  the same string and text-block rules

Only blocks with `type` equal to the Claude text-block constant and a string
`text` member contribute. Images, tool-use blocks, tool-result blocks, unknown
objects, and text-like fields inside them are ignored. User, assistant,
developer, and tool messages are never scanned. Collected parts are joined
with newlines without changing the request.

The response body never participates in request detection. Ordinary prose
that mentions a security monitor, a tool named `security_monitor`, or a normal
answer containing `<block>` cannot activate validation by itself.

## Exact Response Contract

For a detected classifier request, the validator requires an object with
`type: "message"`, `role: "assistant"`, and an array-valued `content` member.
The content array must contain exactly one text block and zero actionable or
unknown blocks.

The text block is valid only when all of these conditions hold.

- Its `text` member is a string.
- After outer whitespace is removed, the complete string is exactly
  `<block>no</block>` or `<block>yes</block>`.
- Matching is case-sensitive.
- No prefix, suffix, prose, second tag, or second text block exists.

Any number of well-formed non-actionable thinking blocks may accompany the
decision. A normal thinking block must have a string `thinking` member. A
redacted-thinking block must have a string `data` member. Existing signature
or metadata fields on those blocks do not make them actionable. Both block
types are discarded from the client-facing classifier response after the
decision is accepted.

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

On success, outer decision whitespace is removed and the output becomes
exactly one block.

```json
{
  "type": "text",
  "text": "<block>no</block>"
}
```

The returned Message keeps its existing ID, role, model, stop reason, stop
sequence, usage, and other top-level metadata. Only `content` is replaced. The
same rule applies to `<block>yes</block>`.

## Handler Integration and Ordering

### True non-streaming responses

`open-sse/handlers/chatCore/nonStreamingHandler.js` keeps every current parser
and converter. Immediately after `translatedResponse` is assembled, and only
when `sourceFormat` is Claude, it assigns the result of
`validateClaudeClassifierMessage(body, translatedResponse)`.

This placement covers native Claude JSON, OpenAI Chat JSON, OpenAI Responses
JSON, and unexpected SSE consumed by the non-streaming handler. It runs before
the generic useful-content check so an empty classifier gets the classifier's
specific 502 rather than the unrelated empty-content cooldown error.

Provider-response logging, `onRequestSuccess`, and usage extraction already
occur before translation. Their ordering and totals remain unchanged. Valid
responses continue through usage filtering, JSON-fence handling, canonical
model echo, request-detail recording, and the existing success return.

### Forced Responses SSE

`open-sse/handlers/chatCore/sseToJsonHandler.js` keeps
`convertResponsesStreamToJson`, current message selection, reasoning blocks,
tool mapping, incomplete-status mapping, cached-token accounting, and all
non-Claude branches. After the Claude branch has built `finalResp`, and before
the success return, it validates and reassigns that final Message.

The validator receives no raw Responses item. A reasoning item can become an
allowed thinking block, while a Responses function or custom-tool call becomes
an actionable block and therefore fails the classifier contract.

### Forced Chat Completions SSE

The same handler keeps `parseSSEToOpenAIResponse`, reasoning and tool-delta
assembly, usage reattachment, JSON-fence handling, and the existing
OpenAI-to-Claude conversion. After that conversion has built `finalBody`, and
before success is returned, it validates and reassigns the final Message.

No validator call is added to the streaming response handler. A request with
`stream: true` is outside this classifier seam and follows the current stream
path unchanged.

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
Caller abort status 499 stays terminal. Existing upstream 401, 429, 503, and
504 handling stays unchanged and is never converted into a classifier answer.

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
- `src/sse/handlers/chat.js`, `open-sse/handlers/chatCore.js`, model services,
  capability lookup, combo lookup, and request translators do not change.
- `applyCodexFastMode` remains after passthrough or translation and before
  executor dispatch.
- A Fast-enabled Codex Sol request without a client tier still sends
  `service_tier: "priority"`.
- Explicit client `service_tier: "default"` and `service_tier: "priority"`
  remain exact and take precedence over the automatic Fast tier.
- Classifier detection and validation occur only after the executor has
  returned and a final Claude Message exists.
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

Add the pure detector, validator, and only the Responses SSE call site. Rerun
the same test to GREEN before adding another path.

### Pure detector and validator matrix

Tests must prove all detector conjunctions and near misses.

1. Detect `stream: false` and a missing stream member.
2. Detect top-level system strings, system text-block arrays, and role-system
   messages.
3. Accept outer whitespace around the exact stop sentinel.
4. Ignore marker text inside user, assistant, tool, tool-result, image, and
   unknown blocks.
5. Bypass `stream: true`, missing or wrong stop sentinels, and missing or
   near-miss security-monitor phrases.
6. Prove detection does not mutate a deeply frozen request.

Tests must then cover both exact decisions and every rejection class in the
response contract. Include thinking plus one exact decision, redacted thinking
plus one exact decision, malformed thinking, empty output, multiple text
blocks, tool use, decision plus tool use, unknown blocks, changed case,
prefixes, suffixes, and multiple tags. Assert valid canonicalization uses new
Message and content objects while the original deeply frozen Message remains
unchanged. Assert a non-classifier Message is returned by identity.

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
decision prevents fallback, and a 499 response is terminal. Preserve current
401, 429, 503, and 504 behavior without synthesizing a decision.

Use a mocked executor around the real `handleChatCore` request ordering. A
Claude classifier request routed to Codex `gpt-5.6-sol` must reach the executor
with `service_tier: "priority"` when Fast is enabled, then fail with the
classifier 502 when the executor returns malformed Responses SSE. Parameterize
explicit `default` and `priority` tiers and assert they reach the executor
unchanged before the same later validation. This test observes ordering but
does not edit the request path.

## Ownership

Implementation ownership is limited to these four paths.

```text
open-sse/handlers/chatCore/claudeClassifier.js
open-sse/handlers/chatCore/nonStreamingHandler.js
open-sse/handlers/chatCore/sseToJsonHandler.js
tests/unit/claude-auto-mode-classifier.test.js
```

The two existing converter functions remain in their current handlers. Moving
or deduplicating them is outside this task because
`nonStreamingHandler.js` imports the SSE parser and a converter refactor would
create a separate circular-import and regression review.

Existing tests may be run but are not edited. If implementation requires a
fifth path, request-side change, or converter replacement, stop and refresh the
design.

## Exclusions

- No cherry-pick, merge, or raw application of PR 3319
- No `-1m` or `[1m]` suffix logic
- No model, alias, provider registry, capability, combo, or routing change
- No edit to `src/sse/handlers/chat.js` or `open-sse/handlers/chatCore.js`
- No edit to `open-sse/config/codexFastMode.js`, executor request bodies, or
  service-tier policy
- No request translation, system prompt, context metadata, tool, usage,
  canonical echo, JSON-fence, or empty-content policy change
- No streaming classifier validation
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
8. Run `git diff --check` and confirm the diff contains only the four owned
   paths and no suffix, request, Fast, model, capability, combo, persistence,
   UI, tracking, or baseline change.
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
npx eslint \
  open-sse/handlers/chatCore/claudeClassifier.js \
  open-sse/handlers/chatCore/nonStreamingHandler.js \
  open-sse/handlers/chatCore/sseToJsonHandler.js \
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
