# Claude Response Classifier Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fail closed on every malformed non-streaming Claude Code security-classifier decision while preserving all ordinary response conversion, request routing, fallback, and service-tier behavior.

**Architecture:** Add one response-only leaf that detects the two classifier request shapes, projects every raw Responses output item before lossy conversion, and applies one exact-decision validator after an Anthropic Message exists. Wire it into the existing Responses SSE, Chat SSE, Responses JSON, Chat JSON, and native Claude JSON return seams, then return caller aborts before application account mutation.

**Tech Stack:** JavaScript ES modules, Web Streams and `ReadableStream.tee()`, Next.js route handlers, Vitest 4, Node.js 25.

## Global Constraints

- Frozen implementation base is `abacb8a40b65db1924c759b861b0f694ca3b5588`, whose only changes after `bbf75669a` are the approved design commits.
- Owned production paths are exactly `open-sse/handlers/chatCore/claudeClassifier.js`, `open-sse/handlers/chatCore/nonStreamingHandler.js`, `open-sse/handlers/chatCore/sseToJsonHandler.js`, and `src/sse/handlers/chat.js`.
- Owned test path is exactly `tests/unit/claude-auto-mode-classifier.test.js`.
- Do not edit `open-sse/handlers/chatCore.js`, `open-sse/services/combo.js`, any converter, model service, provider registry, capability lookup, executor, request translator, Codex Fast policy, persistence module, UI, tracking file, snapshot, baseline, dependency manifest, or lockfile.
- Do not cherry-pick, merge, or raw-apply PR 3319. Do not add `-1m` or `[1m]` normalization.
- Detection requires a Claude client request, non-streaming shape, exact system prefix, and one accepted stage stop shape. Response text never participates in detection.
- Responses SSE and JSON classifier paths project every raw output item before conversion. Chat and native-Claude paths validate every final Anthropic content block.
- Ordinary requests return the existing object or consume the existing stream exactly once. They are never teed, projected, cloned, or canonicalized.
- A valid classifier decision is case-sensitive and, after outer whitespace only, exactly `<block>no</block>` or `<block>yes</block>`. Thinking is discardable. Every other item or block fails closed.
- Every typed validation failure maps through `createErrorResult(HTTP_STATUS.BAD_GATEWAY, CLAUDE_CLASSIFIER_ERROR_MESSAGE)`. No response text appears in the error.
- Status 499 returns before replay detection, account mutation, counters, retry, exclusion, credential reselection, combo fallback, model lock, cooldown, or timer creation.
- `applyCodexFastMode` remains after request translation. Automatic Fast sends `service_tier: "priority"`, while explicit `default` and `priority` remain exact.
- Real IDs `windsurf/claude-sonnet-4.6-thinking-1m`, `windsurf/claude-sonnet-4.6-1m`, and `devin-cli/claude-sonnet-4.6-thinking-1m` remain exact.
- Use strict TDD. Save the first Responses SSE RED plus one separate RED for each later handler hook before its production edit.
- After any test or build, inspect `git status --short`. If a generated file outside the five owned paths changes, stop and report it. In particular, never commit or silently reverse the known generated snapshot churn in `tests/translator/__snapshots__/golden-request.test.js.snap`, `tests/translator/__snapshots__/golden-response-stream.test.js.snap`, or `tests/translator/__snapshots__/golden-translator-concerns.test.js.snap`.

## Frozen Baseline and File Structure

Root and test dependencies were installed with `npm install` because this repository has no lockfile. At planning time the worktree was clean. The current seven-file adjacency command runs 113 tests with 111 passing and the two pre-existing `combo-autoswitch.test.js` failures. The failures are `web_search tool -> search` and `keeps order when no model matches`; they are baseline, not passes.

Files have these responsibilities.

- `open-sse/handlers/chatCore/claudeClassifier.js` owns the detector, lossless Responses JSON and SSE projection, typed error, exact validator, and canonical Message clone.
- `open-sse/handlers/chatCore/sseToJsonHandler.js` owns one classifier-only Responses stream tee, forced Responses final validation, and forced Chat final validation.
- `open-sse/handlers/chatCore/nonStreamingHandler.js` owns classifier-only unexpected-SSE and Responses JSON capture plus one final validation seam for all JSON families.
- `src/sse/handlers/chat.js` owns only the early status-499 return.
- `tests/unit/claude-auto-mode-classifier.test.js` owns fixed request, Message, JSON, raw SSE, handler, application-loop, combo, Fast-tier, and real-`-1m` fixtures.

Use these exact public interfaces.

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

The opaque projection is a plain object with this internal contract. The handlers pass it through but never inspect it.

```js
{
  entries: [{
    kind: "text" | "thinking" | "actionable" | "unknown" | "malformed",
    eventOrdinal: number | null,
    outputIndex: number | null,
    itemIndex: number | null,
    blockIndex: number | null,
    type: string | null,
    text: string | null,
  }],
}
```

Every logical output item produces at least one entry. Each message content block and reasoning summary block produces its own entry. No raw provider object, request, Message, content array, stream chunk, or projection is mutated.

Use fixed fixtures with no `Date.now()` or random IDs.

```js
const SYSTEM_PREFIX = "You are a security monitor for autonomous AI coding agents";
const STAGE_ONE_BODY = Object.freeze({
  model: "subscription",
  stream: false,
  system: `${SYSTEM_PREFIX}. Return one exact decision.`,
  stop_sequences: ["</block>"],
  messages: [{ role: "user", content: "Classify this action." }],
});
const STAGE_TWO_BODY = Object.freeze({
  model: "subscription",
  stream: false,
  system: [{ type: "text", text: `${SYSTEM_PREFIX}: verify the first result.` }],
  messages: [{ role: "user", content: "Verify this action." }],
});
const CLASSIFIER_ERROR = {
  error: {
    message: "Claude Code classifier returned an invalid decision; expected exactly <block>no</block> or <block>yes</block>.",
    type: "server_error",
    code: "bad_gateway",
  },
};
```

The test module must define these helpers once and reuse them.

```js
const textItem = (text) => ({
  type: "message",
  role: "assistant",
  content: [{ type: "output_text", text }],
});
const reasoningItem = (text) => ({
  type: "reasoning",
  summary: [{ type: "summary_text", text }],
});
const readableFromChunks = (chunks) => new ReadableStream({
  start(controller) {
    const encoder = new TextEncoder();
    for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
    controller.close();
  },
});
const frame = (event, data, eol = "\n") =>
  `event: ${event}${eol}data: ${JSON.stringify(data)}${eol}${eol}`;
const doneFrame = (item, outputIndex = 0, eol = "\n") => frame(
  "response.output_item.done",
  { type: "response.output_item.done", output_index: outputIndex, item },
  eol,
);
const terminalFrame = (output, eol = "\n") => frame(
  "response.completed",
  {
    type: "response.completed",
    response: {
      id: "resp_classifier_1700000000",
      created_at: 1700000000,
      model: "gpt-5.6-sol",
      status: "completed",
      ...(output === undefined ? {} : { output }),
      usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 },
    },
  },
  eol,
);
```

---

### Task 1: Lossless Responses classifier vertical slice

**Files:**
- Create: `open-sse/handlers/chatCore/claudeClassifier.js`
- Modify: `open-sse/handlers/chatCore/sseToJsonHandler.js:1-10,278-442`
- Create: `tests/unit/claude-auto-mode-classifier.test.js`

**Interfaces:**
- Consumes: `ROLE`, `CLAUDE_BLOCK`, and `RESPONSES_ITEM` from `open-sse/translator/schema/index.js`; the raw `ReadableStream` and request body already passed to `handleForcedSSEToJson`.
- Produces: the four exported leaf functions and typed error above; a classifier-only stream tee; a canonical Claude Message or fixed 502 from the forced Responses SSE path.

- [ ] **Step 1: Add and run only the first load-bearing RED**

Mock only `@/lib/usageDb.js`, import the real `FORMATS` and `handleForcedSSEToJson`, and send one `response.output_item.done` containing `This looks safe to me.` followed by one successful terminal frame.

```js
it("rejects malformed classifier prose from forced Responses SSE", async () => {
  const result = await handleForcedSSEToJson(forcedResponsesContext(
    STAGE_ONE_BODY,
    [doneFrame(textItem("This looks safe to me.")), terminalFrame()],
  ));

  expect(result.success).toBe(false);
  expect(result.status).toBe(502);
  expect(await result.response.json()).toEqual(CLASSIFIER_ERROR);
});
```

Run from `tests/`.

```bash
npx vitest run --config vitest.config.js \
  unit/claude-auto-mode-classifier.test.js \
  -t "rejects malformed classifier prose from forced Responses SSE"
```

Expected RED is one failed test because current `abacb8a40` returns success and HTTP 200 with the prose. Save the output before any production edit.

- [ ] **Step 2: Add the complete detector and direct validator RED matrices**

Add table-driven detector cases for all of the following exact rows.

| Accepted detector rows |
|---|
| Stage one with `stream:false`, top-level system string, and exact sentinel |
| Stage one with missing `stream`, first system text block, outer sentinel whitespace, and an extra stop entry |
| Stage two with `stream:false`, top-level system string, and absent `stop_sequences` |
| Stage two with missing `stream`, first system text block, and empty `stop_sequences` |
| Prefix followed by end of text, one whitespace character, period, and colon |

| Rejected detector rows |
|---|
| Non-object bodies `null`, boolean, number, string, and array |
| `stream` values `true`, `null`, string, number, array, and object |
| Leading whitespace, changed case, generic `security monitor`, and an alphanumeric prefix continuation |
| Exact prefix only in a later system block, role-system message, user block, assistant block, tool-result block, image block, or unknown block |
| Empty system array, non-text first block, missing first-block text, and non-string first-block text |
| Present stop values `null`, string, number, object, wrong non-empty array, substring sentinel, and case-variant sentinel |
| Exact stop sentinel without the exact prefix and an exact prefix quoted later in an ordinary system prompt |

Deep-freeze both accepted request fixtures and assert no mutation. The boundary row is parameterized into four Vitest cases. The listed primitive and location rows each count as their own Vitest case.

Add direct Message validation rows.

| Valid rows | Assertion |
|---|---|
| Exact allow, exact deny, and each with outer whitespace | New Message and content references, one trimmed text block, all top-level metadata preserved |
| Well-formed thinking plus one decision | Thinking removed and decision preserved |
| Well-formed redacted thinking plus one decision | Redacted thinking removed and decision preserved |
| Non-classifier Message | Original reference returned |

| Invalid rows |
|---|
| Missing Message, array Message, wrong type, wrong role, missing content, non-array content, and empty content |
| Empty text, whitespace text, prose, case variant, prefix text, suffix text, two tags in one text, and two text blocks |
| Thinking-only, malformed thinking, malformed redacted thinking, tool-use, image, document, tool-result, and unknown block |
| Exact decision plus tool-use and exact decision plus unknown block |

For each classifier rejection, assert `toThrowError(ClaudeClassifierValidationError)`, exact `.code`, exact message, and absence of the invalid output from the thrown text. Deep-freeze the original Message and assert it remains byte-equal. Deep-freeze one supplied Responses projection and assert validation neither edits its entries nor replaces their objects.

Run the dedicated file. Expected RED is module-not-found for the new leaf plus the original handler gap. Do not weaken assertions to get a partial green.

- [ ] **Step 3: Add the complete JSON and raw SSE projection RED matrices**

Direct JSON projector tests must assert exact `kind`, `text`, `itemIndex`, `blockIndex`, and entry order for these rows.

| Raw `output` row | Expected projection |
|---|---|
| One exact message | One `text` entry |
| Reasoning then exact message | One `thinking`, then one `text` |
| Two message items | Two distinct text entries |
| One message with two blocks | Two distinct text entries |
| Empty message | One `malformed` entry |
| Non-assistant message | One `malformed` entry |
| Function call, custom-tool call, function-call output, custom-tool-call output, and additional-tools | One `actionable` entry per item |
| Other type containing a complete `tool` or `call` token | One `actionable` entry |
| Unknown item and unknown message block | One `unknown` entry each |
| Missing output, non-array output, empty output, malformed item, malformed output-text, and malformed reasoning summary | At least one `malformed` entry |

Assert `N` items yield at least `N` entries and `M` content blocks yield exactly `M` block entries. Assert a non-classifier call returns `null` and does not inspect a throwing getter on `responseBody.output`.

Direct stream projector tests use raw bytes, not aggregated JSON. Cover each row below.

| Raw SSE row | Expected projection result |
|---|---|
| One done item plus one successful terminal | One text entry |
| Same valid fixture split inside the multibyte `🌊` sequence and at every other byte boundary | Same one text entry |
| Data-only CRLF frames whose JSON `type` supplies the event | Same one text entry |
| Explicit `event:` disagrees with JSON `type` | Explicit event controls classification |
| Multiple `data:` lines joined with newline | Valid parsed frame or malformed JSON according to the joined payload |
| Matching done items and terminal output copies | One entry per logical item, no double count |
| Terminal output only | Entries in terminal array order |
| `response.done` with absent status and with `done` status | Successful terminal in both cases |
| Distinct allow and deny indexes | Two text entries and rejection by validator |
| Duplicate index with allow then deny | Both text entries preserved plus malformed reconciliation |
| Gap in indexes | Preserved items plus malformed reconciliation |
| Matching count but mismatched index, type, content, or payload | Malformed reconciliation |
| Function call, custom-tool call, unknown item, or unknown nested block beside a decision | Preserved rejecting entry |
| Missing done item, non-integer index, negative index, malformed JSON, or hidden item/content/output on unknown event | Malformed entry |
| Duplicate terminal, incomplete, failed, unsuccessful terminal status, and EOF without successful terminal | Malformed entry |
| Recognized deltas, output-item-added, content-part, call-argument frames, metadata, and `[DONE]` | No invented decision entries |

Assert event ordinals increase in arrival order and duplicate output indexes remain distinct. Assert `projectResponsesClassifierStream` returns `null` without calling `getReader()` for a non-classifier body.

- [ ] **Step 4: Implement the pure leaf**

Import only schema constants. Do not import Node helpers or another production module.

```js
import { CLAUDE_BLOCK, RESPONSES_ITEM, ROLE } from "../../translator/schema/index.js";

const CLASSIFIER_SYSTEM_PREFIX =
  "You are a security monitor for autonomous AI coding agents";
const DECISIONS = new Set(["<block>no</block>", "<block>yes</block>"]);

export const CLAUDE_CLASSIFIER_ERROR_MESSAGE =
  "Claude Code classifier returned an invalid decision; expected exactly <block>no</block> or <block>yes</block>.";

export class ClaudeClassifierValidationError extends Error {
  constructor() {
    super(CLAUDE_CLASSIFIER_ERROR_MESSAGE);
    this.name = "ClaudeClassifierValidationError";
  }
  code = "CLAUDE_CLASSIFIER_INVALID_DECISION";
}
```

Implement detection with exact own-member semantics.

```js
export function isClaudeClassifierRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  if (Object.hasOwn(body, "stream") && body.stream !== false) return false;

  const systemText = typeof body.system === "string"
    ? body.system
    : Array.isArray(body.system)
      && body.system[0]?.type === CLAUDE_BLOCK.TEXT
      && typeof body.system[0]?.text === "string"
        ? body.system[0].text
        : null;
  if (systemText == null || !systemText.startsWith(CLASSIFIER_SYSTEM_PREFIX)) return false;
  const next = systemText[CLASSIFIER_SYSTEM_PREFIX.length];
  if (next !== undefined && next !== "." && next !== ":" && !/\s/u.test(next)) return false;

  if (!Object.hasOwn(body, "stop_sequences")) return true;
  if (!Array.isArray(body.stop_sequences)) return false;
  if (body.stop_sequences.length === 0) return true;
  return body.stop_sequences.some(
    (value) => typeof value === "string" && value.trim() === "</block>",
  );
}
```

Use one internal `projectOutput(output, eventOrdinal = null)` function for JSON, terminal-only SSE, and done-frame SSE. A message must be assistant-role with a non-empty content array. Each `output_text` string becomes one text entry. A reasoning item with absent or empty summary produces one thinking entry with `text:null`; every present summary member must be `summary_text` with string text. Call and tool token types are actionable. Unknown types are unknown. Recognized items with malformed required members are malformed.

Use `/(^|_)(?:tool|call)(?:_|$)/u` for the conservative actionable-type fallback after the fixed `RESPONSES_ITEM` cases. Stable reasoning metadata such as `id`, `status`, and encrypted content does not add entries and cannot become a decision.

Implement an internal recursive structural equality function that compares primitives, arrays in order, and object own keys independent of key order. This keeps the leaf free of non-schema imports.

The stream projector must use one streaming `TextDecoder("utf-8", { fatal: false })`, preserve incomplete UTF-8 between reads, accept LF and CRLF, join all data lines with `\n`, and dispatch a trailing frame at EOF. For each parsed frame, the explicit `event:` value wins over `parsed.type`.

Treat these exact fragment events as transport-only. They never create decision text.

```js
const RESPONSES_FRAGMENT_EVENTS = new Set([
  "response.output_item.added",
  "response.content_part.added",
  "response.content_part.done",
  "response.output_text.delta",
  "response.output_text.done",
  "response.reasoning_summary_part.added",
  "response.reasoning_summary_part.done",
  "response.reasoning_summary_text.delta",
  "response.reasoning_summary_text.done",
  "response.function_call_arguments.delta",
  "response.function_call_arguments.done",
  "response.custom_tool_call_input.delta",
  "response.custom_tool_call_input.done",
]);
```

Ignore content-free lifecycle metadata such as `response.created`, `response.queued`, and `response.in_progress`. An event outside the fixed terminal, done-item, fragment, and metadata cases is malformed when it exposes `item`, `content`, or `response.output`; otherwise ignore it as content-free metadata.

Maintain `doneRecords`, `terminalFrames`, and `entries`. Append every done item before reconciliation, even with a duplicate or invalid index. A successful terminal is `response.completed` or `response.done` with absent, `completed`, or `done` status. Any other terminal or terminal count other than one adds malformed evidence. Reconcile as follows.

```js
if (doneRecords.length > 0) {
  require unique integer indexes covering 0..doneRecords.length - 1;
}
if (doneRecords.length === 0 && Array.isArray(terminalOutput)) {
  entries.push(...projectOutput(terminalOutput, terminalOrdinal).entries);
} else if (doneRecords.length > 0 && terminalOutput === undefined) {
  // Keep already projected done records.
} else if (doneRecords.length > 0 && Array.isArray(terminalOutput)) {
  require equal lengths and structural equality at each done output index;
} else {
  append one malformed entry;
}
```

Invalid JSON in a non-empty data frame adds malformed evidence. Ignore `[DONE]`, recognized transport fragments, and content-free metadata. An unrecognized event exposing `item`, `content`, or `response.output` adds malformed evidence.

Both public projectors call the detector first. JSON then projects `responseBody.output`; SSE then consumes the stream exactly once.

The validator adapts final Claude blocks only when projection is null. It requires object Message, `type:"message"`, `role:"assistant"`, array content, exactly one text entry, zero actionable, unknown, or malformed entries, and only well-formed thinking beside the text. For a supplied projection, it still validates the Message envelope but uses only projection entries for the decision. It returns this clone.

```js
return {
  ...message,
  content: [{ type: CLAUDE_BLOCK.TEXT, text: decision.trim() }],
};
```

Every invalid classifier shape throws a new `ClaudeClassifierValidationError`. A non-classifier returns `message` by identity.

- [ ] **Step 5: Tee and validate only the forced Responses SSE classifier path**

Add leaf imports to `sseToJsonHandler.js`. In the actual Responses branch only, evaluate the detector when `sourceFormat === FORMATS.CLAUDE`.

```js
let classifierProjection = null;
if (
  !isGeminiSse
  && sourceFormat === FORMATS.CLAUDE
  && isClaudeClassifierRequest(body)
) {
  const [conversionStream, projectionStream] = providerResponse.body.tee();
  [jsonResponse, classifierProjection] = await Promise.all([
    convertResponsesStreamToJson(conversionStream),
    projectResponsesClassifierStream(body, projectionStream),
  ]);
} else {
  jsonResponse = await convertResponsesStreamToJson(providerResponse.body);
}
```

After the Claude branch builds `finalResp` and before line 438 returns success, call `validateClaudeClassifierMessage(body, finalResp, classifierProjection)`. In the existing catch, map only the typed error before the generic conversion error.

```js
if (err instanceof ClaudeClassifierValidationError) {
  return createErrorResult(
    HTTP_STATUS.BAD_GATEWAY,
    CLAUDE_CLASSIFIER_ERROR_MESSAGE,
  );
}
```

Do not tee Gemini-created Responses bodies, Responses clients, Chat SSE, or ordinary Claude requests.

- [ ] **Step 6: Run Task 1 GREEN and mutation checks**

```bash
npx vitest run --config vitest.config.js \
  unit/claude-auto-mode-classifier.test.js
node --check ../open-sse/handlers/chatCore/claudeClassifier.js
node --check ../open-sse/handlers/chatCore/sseToJsonHandler.js
```

Expected is one file passed with zero skips and every Task 1 matrix row green. Record the exact dedicated test count for later arithmetic. Confirm the ordinary Responses fixture receives the same body reference in the converter spy, the classifier conversion branch sees the same bytes as the projector, and every deep-frozen input remains unchanged.

- [ ] **Step 7: Commit the Responses vertical slice**

```bash
git add open-sse/handlers/chatCore/claudeClassifier.js \
  open-sse/handlers/chatCore/sseToJsonHandler.js \
  tests/unit/claude-auto-mode-classifier.test.js
git commit -m "fix(claude): validate Responses classifier decisions"
git log --oneline -1
```

Expected HEAD subject is exactly `fix(claude): validate Responses classifier decisions` and `git status --short` is empty.

### Task 2: Complete every non-streaming response family

**Files:**
- Modify: `open-sse/handlers/chatCore/nonStreamingHandler.js:1-17,389-554`
- Modify: `open-sse/handlers/chatCore/sseToJsonHandler.js:445-520`
- Modify: `tests/unit/claude-auto-mode-classifier.test.js`

**Interfaces:**
- Consumes: all four Task 1 leaf exports and the existing `translateNonStreamingResponse`, `parseSSEToOpenAIResponse`, and `openAICompletionToClaudeMessage` behavior.
- Produces: one fixed validation contract for OpenAI Chat JSON, OpenAI Responses JSON, native Claude JSON, unexpected Responses SSE, forced Chat SSE, and the existing Gemini-to-Claude branch.

- [ ] **Step 1: Add a separate path RED before each missing hook**

Add the malformed-prose test for one family, run only that named test, save the RED, then add that family's call site. Repeat in this order.

1. Forced Chat Completions SSE.
2. OpenAI Chat Completions JSON.
3. OpenAI Responses JSON.
4. Native Claude JSON.
5. Unexpected Responses SSE handled by `handleNonStreamingResponse`.
6. Gemini SSE converted to a final Claude Message.

Each RED asserts status 502 and exact `CLASSIFIER_ERROR`. The current failure must be HTTP 200 or the existing generic path, never a missing fixture or mock exception.

- [ ] **Step 2: Add valid, invalid, and unchanged family matrices**

For each of the six families, add exact allow and deny success rows. Assert one canonical text block and preservation of fixed ID, model, role, stop reason, stop sequence, usage, and family-specific top-level metadata.

Add these path-specific rejection rows.

- OpenAI Chat JSON with no choice, prose, tool call, and decision plus tool call.
- Native Claude JSON with missing content, thinking-only, malformed thinking, tool use, two text blocks, and decision plus unknown block.
- Responses JSON with earlier prose then decision, allow then deny, deny then allow, duplicate identical decisions, two blocks, empty message then decision, function call, custom-tool call, both call-output types, additional-tools, unknown item, unknown nested block, malformed reasoning, missing output, empty output, and non-array output.
- Unexpected Responses SSE with duplicate output index, hidden custom tool, terminal mismatch, and EOF before terminal.
- Chat SSE with prose, two assembled text segments that form extra surrounding prose, reasoning plus decision, tool-use deltas, and decision plus tool-use deltas.
- Gemini SSE with prose, and Gemini SSE with a function call beside a decision. Assert the current conversion exposes `tool_use` and the validator returns 502.

For each family, freeze one ordinary non-classifier request and compare the final parsed response deeply to a fixed current-behavior fixture. Include Responses reasoning, custom tool, incomplete status, cache-aware usage, JSON fence, canonical model echo, empty-content fallback, Chat reasoning, native Claude content, and Gemini text across the set. Ordinary Responses calls must prove the projector export was not called and the body was not teed.

- [ ] **Step 3: Add non-streaming projection capture and final validation**

Import the leaf exports. Initialize `let classifierProjection = null` beside `let responseBody`.

For unexpected actual Responses SSE only, tee and consume concurrently under the same predicate used in Task 1.

```js
if (
  targetFormat === FORMATS.OPENAI_RESPONSES
  && sourceFormat === FORMATS.CLAUDE
  && isClaudeClassifierRequest(body)
) {
  const [conversionStream, projectionStream] = providerResponse.body.tee();
  [responseBody, classifierProjection] = await Promise.all([
    convertResponsesStreamToJson(conversionStream),
    projectResponsesClassifierStream(body, projectionStream),
  ]);
} else {
  responseBody = await convertResponsesStreamToJson(providerResponse.body);
}
```

Immediately after `await providerResponse.json()` succeeds and before unwrapping, logging, decloaking, usage extraction, or translation, capture only actual Responses JSON.

```js
if (
  sourceFormat === FORMATS.CLAUDE
  && targetFormat === FORMATS.OPENAI_RESPONSES
  && !contentType.includes("text/event-stream")
) {
  classifierProjection = projectResponsesClassifierOutput(body, responseBody);
}
```

Change `const translatedResponse` to `let translatedResponse`. Immediately after translation and before useful-content handling, validate in a local typed catch.

```js
try {
  translatedResponse = validateClaudeClassifierMessage(
    body,
    translatedResponse,
    classifierProjection,
  );
} catch (err) {
  if (err instanceof ClaudeClassifierValidationError) {
    return createErrorResult(
      HTTP_STATUS.BAD_GATEWAY,
      CLAUDE_CLASSIFIER_ERROR_MESSAGE,
    );
  }
  throw err;
}
```

Keep provider-response logging, `onRequestSuccess`, usage extraction, usage persistence, and their ordering before translation. Keep usage filtering, JSON fences, canonical echo, request detail, and success serialization after validation. An empty classifier must reach the classifier 502 before `hasUsefulContent` can create the cooldown error.

For one malformed forced Responses result and one malformed JSON result, assert `onRequestSuccess` and the existing usage append callback still run exactly once before the client receives 502. This pins the billed-upstream ordering without treating semantic validation as provider transport failure.

- [ ] **Step 4: Validate forced Chat SSE and Gemini final Messages**

In the standard Chat SSE branch, validate only after `finalBody` is built and before its success return. In the existing catch, map the typed error before the generic Chat conversion error.

The Gemini branch stays unteed and has `classifierProjection === null`. When `sourceFormat === FORMATS.CLAUDE`, validate the final `finalResp` after current Gemini conversion. Do not add a Gemini wire projector.

Use the same typed catch code as Task 1. Do not change either converter, reasoning assembly, tool mapping, usage reattachment, fence handling, incomplete mapping, or any non-Claude branch.

- [ ] **Step 5: Run the full response-family GREEN and adjacency**

From `tests/` run the dedicated module, then current adjacency.

```bash
npx vitest run --config vitest.config.js \
  unit/claude-auto-mode-classifier.test.js
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

Expected dedicated result is zero failures and zero skips. Combined total is `113 + dedicated_count` tests. Exactly the two frozen `combo-autoswitch.test.js` failures may remain, so passing count is `111 + dedicated_count`; any other failure stops the task.

- [ ] **Step 6: Commit the remaining response seams**

```bash
git add open-sse/handlers/chatCore/nonStreamingHandler.js \
  open-sse/handlers/chatCore/sseToJsonHandler.js \
  tests/unit/claude-auto-mode-classifier.test.js
git commit -m "fix(claude): validate all classifier response families"
git log --oneline -1
```

Expected HEAD subject is exactly `fix(claude): validate all classifier response families` and status is clean.

### Task 3: Preserve terminal abort, fallback, Fast tiers, and real model IDs

**Files:**
- Modify: `src/sse/handlers/chat.js:389-399`
- Modify: `tests/unit/claude-auto-mode-classifier.test.js`

**Interfaces:**
- Consumes: `{ success:false, status, error, response }` from `handleChatCore`; public `handleChat`, `handleComboChat`, and `getModelUpstreamId` behavior; Task 2 classifier 502.
- Produces: status 499 returned by response identity before application state mutation; unchanged 502 fallback; unchanged automatic and explicit service tiers; exact real `-1m` IDs.

- [ ] **Step 1: Add the application-loop 499 RED and neighboring 502 control**

Use `vi.resetModules`, `vi.doMock`, and `vi.doUnmock` in a dedicated loader. Do not hoist a mock of `open-sse/handlers/chatCore.js`, because later tests need the real core. Reuse the exact auth, settings, model, token-refresh, logger, and combo mock shapes from `chat-request-replay.test.js`.

Make `handleChatCore` return one fixed 499 result whose `response` object is retained. Call the real exported `handleChat` and assert all of the following.

- Returned Response is the original object by identity.
- Status and body remain 499 and `Request aborted`.
- `handleChatCore` and `getProviderCredentials` run once.
- `markAccountUnavailable`, `clearAccountError`, `updateProviderCredentials`, and every persistence or lock mock run zero times.
- No second credential, same-account replay, exclusion, retry, or timer is observed.

Run only that test. Expected RED is `markAccountUnavailable` called once on current code.

Add a neighboring 502 control with `markAccountUnavailable` returning `{ shouldFallback:false }`. It must call the mutation once and return the same 502 Response, proving no broader early-return rule was added.

- [ ] **Step 2: Add the one-line terminal guard**

Immediately after the existing success return and before request-buffer replay detection, add only this line.

```js
if (result.status === 499) return result.response;
```

Do not inspect classifier content or edit counters, retry limits, replay logic, account mutation, locks, or combo code.

- [ ] **Step 3: Prove real combo fallback and terminal behavior**

Use real `handleComboChat` with fake timers and handler-backed Responses.

```js
vi.useFakeTimers();
const pending = handleComboChat({
  body: STAGE_ONE_BODY,
  models: ["cx/gpt-5.6-sol", "cc/claude-opus-4-8"],
  handleSingleModel,
  log: { info: vi.fn(), warn: vi.fn() },
  comboName: "subscription",
  comboStrategy: "fallback",
});
await vi.advanceTimersByTimeAsync(5000);
const response = await pending;
```

Cover these rows.

- First model returns the real classifier 502 from a malformed handler response, second returns a valid canonical decision, and both are called once in order.
- First model returns a valid canonical decision, second is never called, and no timer exists.
- First model returns one fixed 499 Response, the same object is returned, second is never called, and `vi.getTimerCount()` remains zero without advancing time.
- Existing 401, 429, 503, and 504 error Responses keep their current status and never synthesize an allow or deny decision. Advance only timers required by existing behavior.

- [ ] **Step 4: Prove Fast and explicit tiers before later validation**

Create a fresh-module loader around the real `handleChatCore`. Mock `getExecutor` to capture its request and return malformed Responses SSE. Reuse the dependency mock contracts from `chat-connect-timeout-propagation.test.js`, but leave both response handlers real. The Claude request uses `STAGE_ONE_BODY`, `sourceFormatOverride: FORMATS.CLAUDE`, `modelInfo: { provider:"codex", model:"gpt-5.6-sol" }`, and `stream:false`.

Parameterize these three rows.

| `codexFastMode` | Client `service_tier` | Captured executor tier |
|---|---|---|
| `true` | absent | `priority` |
| `true` | `default` | `default` |
| `true` | `priority` | `priority` |

Each executor call occurs once, captures the expected final request tier, then returns the exact classifier 502. Assert `open-sse/handlers/chatCore.js` and `open-sse/config/codexFastMode.js` remain absent from the diff.

- [ ] **Step 5: Prove request and model invariants without production edits**

Import real `getModelUpstreamId` and assert exact identity for these rows.

```js
it.each([
  ["windsurf", "claude-sonnet-4.6-thinking-1m"],
  ["windsurf", "claude-sonnet-4.6-1m"],
  ["devin-cli", "claude-sonnet-4.6-thinking-1m"],
])("preserves real %s model %s", (provider, model) => {
  expect(getModelUpstreamId(provider, model)).toBe(model);
});
```

Deep-freeze classifier requests passed directly to the leaf and handler fixtures. Assert system, messages, tools, model, stop sequences, and service tier are byte-equal afterward. Assert normal classifier success preserves ID, model, usage, stop metadata, and top-level extensions while replacing only content.

- [ ] **Step 6: Run Task 3 GREEN and commit**

```bash
npx vitest run --config vitest.config.js \
  unit/claude-auto-mode-classifier.test.js \
  unit/chat-request-replay.test.js \
  unit/chat-connect-timeout-propagation.test.js \
  unit/combo-routing.test.js
node --check ../src/sse/handlers/chat.js
```

Expected is zero new failures. The dedicated module has zero skips. The application 499 test observes zero mutation and timers. The neighboring 502 test and real combo test still fall back.

```bash
git add src/sse/handlers/chat.js \
  tests/unit/claude-auto-mode-classifier.test.js
git commit -m "fix(chat): keep caller aborts terminal"
git log --oneline -1
```

Expected HEAD subject is exactly `fix(chat): keep caller aborts terminal` and status is clean.

### Task 4: Full verification and scope proof

**Files:**
- Verify: the five owned implementation paths and the committed design and plan.

**Interfaces:**
- Consumes: completed Tasks 1-3.
- Produces: fresh focused, adjacency, static, full-suite, no-regression, build, scope, and independent-review receipts. This task performs no source edit and no push.

- [ ] **Step 1: Run focused and adjacency gates**

Run from `tests/`.

```bash
npx vitest run --config vitest.config.js \
  unit/claude-auto-mode-classifier.test.js
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

Expected focused result has zero failures and zero skips. Expected adjacency total is `113 + dedicated_count`, with `111 + dedicated_count` passing and only the two frozen `combo-autoswitch` failures. Any other failure stops verification.

- [ ] **Step 2: Run syntax, lint, and diff checks**

Run from the worktree root.

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
git diff --check bbf75669a...HEAD
```

Expected all commands exit zero. Do not use an unrelated repository-wide lint failure to hide a touched-file lint failure.

- [ ] **Step 3: Run the full suite through the baseline verifier**

Record `git status --short` before this gate. Run exactly once from the worktree root.

```bash
(cd tests && npx vitest run --reporter=json \
  --outputFile=/tmp/task7-pr3319-vitest.json)
node tests/__baseline__/verify-no-regression.mjs \
  /tmp/task7-pr3319-vitest.json
git status --short
```

The frozen base has 3,498 tests, 60 known failures, and 57 pending. The new total must equal `3,498 + dedicated_count`; the 60 known failures and 57 pending may remain, and the no-regression verifier must exit zero. Any new failure is a stop.

If any generated path appears after the suite, stop without committing, restoring, or deleting it. Report the exact paths to the coordinator. This applies even to the three known snapshot reorder files listed under Global Constraints.

- [ ] **Step 4: Run the production build**

```bash
npm run build
git status --short
```

Expected build exit is zero with 140 routes and successful postbuild asset copying. Any generated tracked file outside scope is a stop.

- [ ] **Step 5: Prove exact ownership and exclusions**

```bash
git diff --name-only bbf75669a...HEAD
git diff --stat bbf75669a...HEAD
git diff bbf75669a...HEAD -- src/sse/handlers/chat.js
if git diff bbf75669a...HEAD -- open-sse src | rg -n -- \
  '-1m|\[1m\]|applyCodexFastMode|providerModels|capabilities|services/combo|chatCore\.js|service_tier'; then
  exit 1
fi
git status --short --branch
git log --oneline bbf75669a..HEAD
```

Expected changed source and test paths are exactly the five owned paths. The design and this plan are the only documentation additions. The application handler diff is one 499 guard. The forbidden-pattern scan may show test assertions for real `-1m` IDs and service tiers, but no production change. Worktree status is clean.

- [ ] **Step 6: Request one independent complete-branch review**

Review `bbf75669a...HEAD` against the approved design. The reviewer must check false-positive detection, every native and translated family, Responses item loss, SSE terminal reconciliation, stream tee concurrency, mutation, error leakage, application 499 ordering, fallback, Fast tiers, real `-1m` IDs, generated churn, and exact ownership.

Critical or Important findings block integration. Apply no speculative refactor. If a load-bearing fix is required, add its RED to the dedicated module, make one scoped fix commit, rerun all applicable gates, and request one scoped re-review.

## Completion Boundary

The implementation is complete only when every detected non-streaming Claude classifier family returns one canonical exact decision or the fixed typed 502, Responses ambiguity remains visible before lossy conversion, ordinary traffic is unchanged, status 499 causes zero account or combo mutation, classifier 502 still falls back, automatic and explicit tiers remain exact, real `-1m` IDs remain exact, and all fresh gates above satisfy their stated counts.

No push, upstream mutation, tracking close, suffix support, converter refactor, or additional PR 3319 hunk belongs to this plan.
