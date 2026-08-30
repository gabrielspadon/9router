import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleForcedSSEToJson } = await import(
  "../../open-sse/handlers/chatCore/sseToJsonHandler.js"
);
const {
  CLAUDE_CLASSIFIER_ERROR_MESSAGE,
  ClaudeClassifierValidationError,
  isClaudeClassifierRequest,
  projectResponsesClassifierOutput,
  projectResponsesClassifierStream,
  validateClaudeClassifierMessage,
} = await import("../../open-sse/handlers/chatCore/claudeClassifier.js");

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

const SYSTEM_PREFIX =
  "You are a security monitor for autonomous AI coding agents";
const STAGE_ONE_BODY = deepFreeze({
  model: "subscription",
  stream: false,
  system: `${SYSTEM_PREFIX}. Return one exact decision.`,
  stop_sequences: ["</block>"],
  messages: [{ role: "user", content: "Classify this action." }],
});
const STAGE_TWO_BODY = deepFreeze({
  model: "subscription",
  stream: false,
  system: [{ type: "text", text: `${SYSTEM_PREFIX}: verify the first result.` }],
  messages: [{ role: "user", content: "Verify this action." }],
});
const withoutStream = ({ stream: _stream, ...body }) => body;
const CLASSIFIER_ERROR = {
  error: {
    message:
      "Claude Code classifier returned an invalid decision; expected exactly <block>no</block> or <block>yes</block>.",
    type: "server_error",
    code: "bad_gateway",
  },
};

const textItem = (text) => ({
  type: "message",
  role: "assistant",
  content: [{ type: "output_text", text }],
});
const reasoningItem = (text) => ({
  type: "reasoning",
  summary: [{ type: "summary_text", text }],
});
const frame = (event, data, eol = "\n") =>
  `event: ${event}${eol}data: ${JSON.stringify(data)}${eol}${eol}`;
const doneFrame = (item, outputIndex = 0, eol = "\n") =>
  frame(
    "response.output_item.done",
    { type: "response.output_item.done", output_index: outputIndex, item },
    eol,
  );
const terminalFrame = (output, eol = "\n") =>
  frame(
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
const readableFromChunks = (chunks) =>
  new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
const readableFromBytes = (chunks) =>
  new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
const projectionEntry = ({
  kind,
  eventOrdinal = null,
  outputIndex = null,
  itemIndex = null,
  blockIndex = null,
  type = null,
  text = null,
}) => ({
  kind,
  eventOrdinal,
  outputIndex,
  itemIndex,
  blockIndex,
  type,
  text,
});
const forcedResponsesContext = (body, chunks) => ({
  providerResponse: new Response(readableFromChunks(chunks), {
    headers: { "content-type": "text/event-stream" },
  }),
  sourceFormat: FORMATS.CLAUDE,
  targetFormat: FORMATS.OPENAI_RESPONSES,
  provider: "codex",
  model: "gpt-5.6-sol",
  body,
  stream: false,
  translatedBody: null,
  finalBody: null,
  requestStartTime: 1700000000000,
  connectionId: "classifier-test-connection",
  apiKey: "classifier-test-key",
  clientRawRequest: { endpoint: "/v1/messages", body },
  onRequestSuccess: vi.fn(async () => {}),
  customToolNames: null,
  trackDone: vi.fn(),
  appendLog: vi.fn(),
  reqTag: "classifier-test",
  log: null,
});

const claudeMessage = (content) => ({
  id: "msg_classifier_1700000000",
  type: "message",
  role: "assistant",
  model: "gpt-5.6-sol",
  content,
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 8, output_tokens: 2 },
  extension: { retained: true },
});

describe("Claude classifier request detector", () => {
  it.each([
    ["stage one string", STAGE_ONE_BODY],
    [
      "stage one first system block",
      {
        ...withoutStream(STAGE_ONE_BODY),
        system: [{ type: "text", text: `${SYSTEM_PREFIX} valid.` }],
        stop_sequences: ["other", "  </block>  "],
      },
    ],
    [
      "stage two string",
      { ...STAGE_TWO_BODY, system: `${SYSTEM_PREFIX} valid stage two.` },
    ],
    [
      "stage two empty stops",
      { ...withoutStream(STAGE_TWO_BODY), stop_sequences: [] },
    ],
  ])("detects %s", (_name, body) => {
    const before = structuredClone(body);
    deepFreeze(body);
    expect(isClaudeClassifierRequest(body)).toBe(true);
    expect(body).toEqual(before);
  });

  it.each([
    ["end", SYSTEM_PREFIX],
    ["whitespace", `${SYSTEM_PREFIX}\ncontinue`],
    ["period", `${SYSTEM_PREFIX}. continue`],
    ["colon", `${SYSTEM_PREFIX}: continue`],
  ])("detects exact prefix boundary %s", (_name, system) => {
    expect(isClaudeClassifierRequest({ system })).toBe(true);
  });

  it.each([
    ["null", null],
    ["boolean", true],
    ["number", 1],
    ["string", SYSTEM_PREFIX],
    ["array", [{ system: SYSTEM_PREFIX }]],
  ])("rejects non-object body %s", (_name, body) => {
    expect(isClaudeClassifierRequest(body)).toBe(false);
  });

  it.each([undefined, true, null, "false", 0, [], {}])(
    "rejects stream value %j",
    (stream) => {
      expect(isClaudeClassifierRequest({ ...STAGE_ONE_BODY, stream })).toBe(false);
    },
  );

  it.each([
    ["leading whitespace", ` ${SYSTEM_PREFIX}`],
    ["changed case", SYSTEM_PREFIX.toUpperCase()],
    ["generic phrase", "You are a security monitor"],
    ["alphanumeric continuation", `${SYSTEM_PREFIX}Extra`],
  ])("rejects system near miss %s", (_name, system) => {
    expect(
      isClaudeClassifierRequest({ ...STAGE_ONE_BODY, system }),
    ).toBe(false);
  });

  it.each([
    [
      "later system block",
      {
        ...STAGE_ONE_BODY,
        system: [
          { type: "text", text: "ordinary" },
          { type: "text", text: SYSTEM_PREFIX },
        ],
      },
    ],
    [
      "role-system message",
      {
        ...STAGE_ONE_BODY,
        system: "ordinary",
        messages: [{ role: "system", content: SYSTEM_PREFIX }],
      },
    ],
    [
      "user block",
      {
        ...STAGE_ONE_BODY,
        system: "ordinary",
        messages: [{ role: "user", content: SYSTEM_PREFIX }],
      },
    ],
    [
      "assistant block",
      {
        ...STAGE_ONE_BODY,
        system: "ordinary",
        messages: [{ role: "assistant", content: SYSTEM_PREFIX }],
      },
    ],
    [
      "tool-result block",
      {
        ...STAGE_ONE_BODY,
        system: "ordinary",
        messages: [{ role: "user", content: [{ type: "tool_result", content: SYSTEM_PREFIX }] }],
      },
    ],
    [
      "image block",
      {
        ...STAGE_ONE_BODY,
        system: "ordinary",
        messages: [{ role: "user", content: [{ type: "image", source: { data: SYSTEM_PREFIX } }] }],
      },
    ],
    [
      "unknown block",
      {
        ...STAGE_ONE_BODY,
        system: "ordinary",
        messages: [{ role: "user", content: [{ type: "future", text: SYSTEM_PREFIX }] }],
      },
    ],
  ])("does not scan %s", (_name, body) => {
    expect(isClaudeClassifierRequest(body)).toBe(false);
  });

  it.each([
    ["empty array", []],
    ["non-text first block", [{ type: "image", text: SYSTEM_PREFIX }]],
    ["missing first text", [{ type: "text" }]],
    ["non-string first text", [{ type: "text", text: 42 }]],
  ])("rejects invalid system array %s", (_name, system) => {
    expect(isClaudeClassifierRequest({ ...STAGE_ONE_BODY, system })).toBe(false);
  });

  it.each([
    ["null", null],
    ["string", "</block>"],
    ["number", 1],
    ["object", { stop: "</block>" }],
    ["wrong array", ["stop"]],
    ["substring", ["before </block> after"]],
    ["case variant", ["</BLOCK>"]],
  ])("rejects stop_sequences %s", (_name, stop_sequences) => {
    expect(
      isClaudeClassifierRequest({ ...STAGE_ONE_BODY, stop_sequences }),
    ).toBe(false);
  });

  it("rejects a sentinel without the prefix", () => {
    expect(
      isClaudeClassifierRequest({
        ...STAGE_ONE_BODY,
        system: "ordinary classifier request",
      }),
    ).toBe(false);
  });

  it("rejects a prefix quoted later in an ordinary prompt", () => {
    expect(
      isClaudeClassifierRequest({
        ...STAGE_ONE_BODY,
        system: `Ordinary instructions quote: ${SYSTEM_PREFIX}`,
      }),
    ).toBe(false);
  });
});

describe("direct Claude classifier Message validation", () => {
  it.each([
    ["allow", "<block>no</block>", "<block>no</block>"],
    ["deny", "<block>yes</block>", "<block>yes</block>"],
    ["allow outer whitespace", " \n<block>no</block>\t", "<block>no</block>"],
    ["deny outer whitespace", "\t<block>yes</block> \n", "<block>yes</block>"],
  ])("validates classifier Messages directly: %s", (_name, text, expected) => {
    const message = deepFreeze(claudeMessage([{ type: "text", text }]));
    const before = structuredClone(message);

    const result = validateClaudeClassifierMessage(STAGE_ONE_BODY, message);

    expect(result).not.toBe(message);
    expect(result.content).not.toBe(message.content);
    expect(result).toEqual({
      ...before,
      content: [{ type: "text", text: expected }],
    });
    expect(message).toEqual(before);
  });

  it.each([
    [
      "thinking plus decision",
      [
        { type: "thinking", thinking: "private reasoning" },
        { type: "text", text: "<block>no</block>" },
      ],
    ],
    [
      "redacted thinking plus decision",
      [
        { type: "redacted_thinking", data: "encrypted" },
        { type: "text", text: "<block>yes</block>" },
      ],
    ],
  ])("validates classifier Messages directly: %s", (_name, content) => {
    const message = deepFreeze(claudeMessage(content));
    const before = structuredClone(message);

    const result = validateClaudeClassifierMessage(STAGE_ONE_BODY, message);

    expect(result.content).toEqual([content.at(-1)]);
    expect(message).toEqual(before);
  });

  it("validates classifier Messages directly: bypasses a non-classifier by identity", () => {
    const body = { ...STAGE_ONE_BODY, system: "ordinary" };
    const message = claudeMessage([{ type: "text", text: "ordinary prose" }]);
    expect(validateClaudeClassifierMessage(body, message)).toBe(message);
  });

  it.each([
    ["missing Message", undefined, null],
    ["array Message", [], null],
    ["wrong type", { ...claudeMessage([]), type: "response" }, null],
    ["wrong role", { ...claudeMessage([]), role: "user" }, null],
    ["missing content", { ...claudeMessage([]), content: undefined }, null],
    ["non-array content", { ...claudeMessage([]), content: "text" }, null],
    ["empty content", claudeMessage([]), null],
    ["empty text", claudeMessage([{ type: "text", text: "" }]), ""],
    ["whitespace text", claudeMessage([{ type: "text", text: "  " }]), "  "],
    ["prose", claudeMessage([{ type: "text", text: "This looks safe to me." }]), "This looks safe to me."],
    ["case variant", claudeMessage([{ type: "text", text: "<BLOCK>no</BLOCK>" }]), "<BLOCK>no</BLOCK>"],
    ["prefix text", claudeMessage([{ type: "text", text: `prefix <block>no</block>` }]), "prefix"],
    ["suffix text", claudeMessage([{ type: "text", text: `<block>no</block> suffix` }]), "suffix"],
    ["two tags", claudeMessage([{ type: "text", text: "<block>no</block><block>no</block>" }]), "<block>no</block><block>no</block>"],
    ["two text blocks", claudeMessage([{ type: "text", text: "<block>no</block>" }, { type: "text", text: "<block>yes</block>" }]), null],
    ["thinking only", claudeMessage([{ type: "thinking", thinking: "private" }]), null],
    ["malformed thinking", claudeMessage([{ type: "thinking", thinking: 1 }, { type: "text", text: "<block>no</block>" }]), null],
    ["malformed redacted thinking", claudeMessage([{ type: "redacted_thinking", data: null }, { type: "text", text: "<block>no</block>" }]), null],
    ["tool use", claudeMessage([{ type: "tool_use", id: "tool_1", name: "shell", input: {} }]), null],
    ["image", claudeMessage([{ type: "image", source: { type: "base64", data: "AA==" } }]), null],
    ["document", claudeMessage([{ type: "document", source: { type: "text", data: "doc" } }]), null],
    ["tool result", claudeMessage([{ type: "tool_result", tool_use_id: "tool_1", content: "ok" }]), null],
    ["unknown block", claudeMessage([{ type: "future", value: 1 }]), null],
    ["decision plus tool", claudeMessage([{ type: "text", text: "<block>no</block>" }, { type: "tool_use", id: "tool_1", name: "shell", input: {} }]), null],
    ["decision plus unknown", claudeMessage([{ type: "text", text: "<block>no</block>" }, { type: "future" }]), null],
  ])("validates classifier Messages directly: rejects %s", (_name, rawMessage, leakedText) => {
    const message = deepFreeze(rawMessage);
    const before = message === undefined ? undefined : structuredClone(message);
    let error;

    try {
      validateClaudeClassifierMessage(STAGE_ONE_BODY, message);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ClaudeClassifierValidationError);
    expect(error.code).toBe("CLAUDE_CLASSIFIER_INVALID_DECISION");
    expect(error.message).toBe(CLAUDE_CLASSIFIER_ERROR_MESSAGE);
    if (leakedText) expect(error.message).not.toContain(leakedText);
    expect(message).toEqual(before);
  });

  it("rejects unresolved frozen projection evidence without mutating caller data", () => {
    const message = deepFreeze(claudeMessage([{ type: "text", text: "<block>no</block>" }]));
    const projection = deepFreeze({
      entries: [projectionEntry({ kind: "text", text: "<block>no</block>" })],
      evidence: [{ eventOrdinal: 0, resolved: false }],
    });
    const projectionBefore = structuredClone(projection);

    expect(() => validateClaudeClassifierMessage(STAGE_ONE_BODY, message, projection))
      .toThrow(ClaudeClassifierValidationError);
    expect(projection).toEqual(projectionBefore);
  });
});

describe("lossless Responses classifier projection", () => {
  it("projects ordered JSON reasoning and decision blocks without conversion loss", () => {
    const projection = projectResponsesClassifierOutput(STAGE_ONE_BODY, {
      output: [reasoningItem("private"), textItem("<block>no</block>")],
    });

    expect(projection).toEqual({
      entries: [
        projectionEntry({
          kind: "thinking",
          itemIndex: 0,
          blockIndex: 0,
          type: "summary_text",
          text: "private",
        }),
        projectionEntry({
          kind: "text",
          itemIndex: 1,
          blockIndex: 0,
          type: "output_text",
          text: "<block>no</block>",
        }),
      ],
      evidence: [],
    });
  });

  it("projects terminal Responses SSE items before the converter selects a message", async () => {
    const projection = await projectResponsesClassifierStream(
      STAGE_ONE_BODY,
      readableFromChunks([
        doneFrame(textItem("<block>yes</block>")),
        terminalFrame(),
      ]),
    );

    expect(projection).toEqual({
      entries: [
        projectionEntry({
          kind: "text",
          eventOrdinal: 0,
          outputIndex: 0,
          itemIndex: 0,
          blockIndex: 0,
          type: "output_text",
          text: "<block>yes</block>",
        }),
      ],
      evidence: [],
    });
  });

  it("keeps every JSON message and content block distinct in output order", () => {
    const projection = projectResponsesClassifierOutput(STAGE_ONE_BODY, {
      output: [
        textItem("<block>no</block>"),
        {
          type: "message",
          role: "assistant",
          content: [
            { type: "output_text", text: "<block>yes</block>" },
            { type: "output_text", text: "<block>no</block>" },
          ],
        },
      ],
    });

    expect(projection.entries).toEqual([
      projectionEntry({
        kind: "text",
        itemIndex: 0,
        blockIndex: 0,
        type: "output_text",
        text: "<block>no</block>",
      }),
      projectionEntry({
        kind: "text",
        itemIndex: 1,
        blockIndex: 0,
        type: "output_text",
        text: "<block>yes</block>",
      }),
      projectionEntry({
        kind: "text",
        itemIndex: 1,
        blockIndex: 1,
        type: "output_text",
        text: "<block>no</block>",
      }),
    ]);
  });

  it.each([
    ["function call", { type: "function_call", id: "fc_1" }, "function_call"],
    ["custom tool call", { type: "custom_tool_call", id: "ctc_1" }, "custom_tool_call"],
    ["function call output", { type: "function_call_output", call_id: "fc_1" }, "function_call_output"],
    ["custom tool output", { type: "custom_tool_call_output", call_id: "ctc_1" }, "custom_tool_call_output"],
    ["additional tools", { type: "additional_tools", tools: [] }, "additional_tools"],
    ["unknown tool shape", { type: "server_tool_call", id: "stc_1" }, "server_tool_call"],
  ])("classifies JSON %s as actionable", (_name, item, type) => {
    const projection = projectResponsesClassifierOutput(STAGE_ONE_BODY, {
      output: [item],
    });

    expect(projection.entries).toEqual([
      projectionEntry({
        kind: "actionable",
        itemIndex: 0,
        type,
      }),
    ]);
  });

  it("keeps unknown JSON items and message blocks visible", () => {
    const projection = projectResponsesClassifierOutput(STAGE_ONE_BODY, {
      output: [
        { type: "future_item", value: "hidden" },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "future_part", value: "hidden" }],
        },
      ],
    });

    expect(projection.entries).toEqual([
      projectionEntry({ kind: "unknown", itemIndex: 0, type: "future_item" }),
      projectionEntry({
        kind: "unknown",
        itemIndex: 1,
        blockIndex: 0,
        type: "future_part",
      }),
    ]);
  });

  it.each([
    ["missing output", {}],
    ["non-array output", { output: "invalid" }],
    ["empty output", { output: [] }],
    ["empty message", { output: [{ type: "message", role: "assistant", content: [] }] }],
    ["non-assistant message", { output: [{ type: "message", role: "user", content: [] }] }],
    ["malformed output text", { output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: null }] }] }],
    ["null reasoning summary", { output: [{ type: "reasoning", summary: null }] }],
    ["malformed reasoning summary", { output: [{ type: "reasoning", summary: [{ type: "summary_text", text: null }] }] }],
  ])("marks malformed JSON shape %s", (_name, responseBody) => {
    const projection = projectResponsesClassifierOutput(STAGE_ONE_BODY, responseBody);
    expect(projection.entries.length).toBeGreaterThan(0);
    expect(projection.entries.some((entry) => entry.kind === "malformed")).toBe(true);
  });

  it("reconciles matching Responses fragments against authoritative terminal items", async () => {
    const message = {
      id: "msg_classifier_safe",
      ...textItem("<block>no</block>"),
    };
    const reasoning = {
      id: "rs_classifier_safe",
      ...reasoningItem("private"),
    };
    const functionCall = {
      id: "fc_classifier_safe",
      type: "function_call",
      name: "shell",
      arguments: "{\"cmd\":\"pwd\"}",
    };
    const customTool = {
      id: "ct_classifier_safe",
      type: "custom_tool_call",
      name: "shell",
      input: "pwd",
    };
    const projection = await projectResponsesClassifierStream(
      STAGE_ONE_BODY,
      readableFromChunks([
        frame("response.output_item.added", { output_index: 0, item: message }),
        frame("response.content_part.added", {
          output_index: 0,
          item_id: message.id,
          content_index: 0,
          part: { type: "output_text" },
        }),
        frame("response.output_text.delta", {
          output_index: 0,
          item_id: message.id,
          content_index: 0,
          delta: "<block>no</block>",
        }),
        frame("response.output_item.added", { output_index: 1, item: reasoning }),
        frame("response.reasoning_summary_part.added", {
          output_index: 1,
          item_id: reasoning.id,
          summary_index: 0,
          part: { type: "summary_text" },
        }),
        frame("response.reasoning_summary_text.delta", {
          output_index: 1,
          item_id: reasoning.id,
          summary_index: 0,
          delta: "private",
        }),
        frame("response.output_item.added", { output_index: 2, item: functionCall }),
        frame("response.function_call_arguments.delta", {
          output_index: 2,
          item_id: functionCall.id,
          delta: "{\"cmd\":\"pwd\"}",
        }),
        frame("response.output_item.added", { output_index: 3, item: customTool }),
        frame("response.custom_tool_call_input.delta", {
          output_index: 3,
          item_id: customTool.id,
          delta: "pwd",
        }),
        terminalFrame([message, reasoning, functionCall, customTool]),
      ]),
    );

    expect(projection.entries.some((entry) => entry.kind === "malformed")).toBe(false);
    expect(projection.evidence).toEqual([
      { eventOrdinal: 0, eventType: "response.output_item.added", outputIndex: 0, itemId: message.id, itemType: "message", blockIndex: null, blockType: null, resolved: true },
      { eventOrdinal: 1, eventType: "response.content_part.added", outputIndex: 0, itemId: message.id, itemType: "message", blockIndex: 0, blockType: "output_text", resolved: true },
      { eventOrdinal: 2, eventType: "response.output_text.delta", outputIndex: 0, itemId: message.id, itemType: "message", blockIndex: 0, blockType: "output_text", resolved: true },
      { eventOrdinal: 3, eventType: "response.output_item.added", outputIndex: 1, itemId: reasoning.id, itemType: "reasoning", blockIndex: null, blockType: null, resolved: true },
      { eventOrdinal: 4, eventType: "response.reasoning_summary_part.added", outputIndex: 1, itemId: reasoning.id, itemType: "reasoning", blockIndex: 0, blockType: "summary_text", resolved: true },
      { eventOrdinal: 5, eventType: "response.reasoning_summary_text.delta", outputIndex: 1, itemId: reasoning.id, itemType: "reasoning", blockIndex: 0, blockType: "summary_text", resolved: true },
      { eventOrdinal: 6, eventType: "response.output_item.added", outputIndex: 2, itemId: functionCall.id, itemType: "function_call", blockIndex: null, blockType: null, resolved: true },
      { eventOrdinal: 7, eventType: "response.function_call_arguments.delta", outputIndex: 2, itemId: functionCall.id, itemType: "function_call", blockIndex: null, blockType: null, resolved: true },
      { eventOrdinal: 8, eventType: "response.output_item.added", outputIndex: 3, itemId: customTool.id, itemType: "custom_tool_call", blockIndex: null, blockType: null, resolved: true },
      { eventOrdinal: 9, eventType: "response.custom_tool_call_input.delta", outputIndex: 3, itemId: customTool.id, itemType: "custom_tool_call", blockIndex: null, blockType: null, resolved: true },
    ]);
  });

  it("does not inspect JSON output or consume an SSE stream for a non-classifier", async () => {
    const throwingBody = {};
    Object.defineProperty(throwingBody, "output", {
      get() {
        throw new Error("must not inspect ordinary output");
      },
    });
    const throwingStream = {
      getReader() {
        throw new Error("must not consume ordinary stream");
      },
    };
    const ordinary = { ...STAGE_ONE_BODY, system: "ordinary" };

    expect(projectResponsesClassifierOutput(ordinary, throwingBody)).toBeNull();
    await expect(projectResponsesClassifierStream(ordinary, throwingStream)).resolves.toBeNull();
  });

  it("accepts terminal-only and matching done-plus-terminal SSE sources without duplicate entries", async () => {
    const item = {
      id: "msg_classifier_safe",
      ...textItem("<block>no</block>"),
    };
    const terminalOnly = await projectResponsesClassifierStream(
      STAGE_ONE_BODY,
      readableFromChunks([terminalFrame([item])]),
    );
    const matchingCopies = await projectResponsesClassifierStream(
      STAGE_ONE_BODY,
      readableFromChunks([doneFrame(item), terminalFrame([item])]),
    );

    expect(terminalOnly.entries).toEqual([
      projectionEntry({
        kind: "text",
        eventOrdinal: 0,
        outputIndex: 0,
        itemIndex: 0,
        blockIndex: 0,
        type: "output_text",
        text: "<block>no</block>",
      }),
    ]);
    expect(matchingCopies.entries).toEqual([
      projectionEntry({
        kind: "text",
        eventOrdinal: 0,
        outputIndex: 0,
        itemIndex: 0,
        blockIndex: 0,
        type: "output_text",
        text: "<block>no</block>",
      }),
    ]);
  });

  it("decodes split UTF-8 and data-only CRLF terminal SSE frames", async () => {
    const waveItem = textItem("<block>no</block> 🌊");
    const splitPayload = `${doneFrame(waveItem)}${terminalFrame()}`;
    const bytes = new TextEncoder().encode(splitPayload);
    const splitProjection = await projectResponsesClassifierStream(
      STAGE_ONE_BODY,
      readableFromBytes(Array.from(bytes, (byte) => Uint8Array.of(byte))),
    );
    const dataOnly = (data) => `data: ${JSON.stringify(data)}\r\n\r\n`;
    const crlfProjection = await projectResponsesClassifierStream(
      STAGE_ONE_BODY,
      readableFromChunks([
        dataOnly({ type: "response.output_item.done", output_index: 0, item: textItem("<block>yes</block>") }),
        dataOnly({
          type: "response.done",
          response: {
            id: "resp_classifier_1700000000",
            status: "done",
            usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 },
          },
        }),
      ]),
    );

    expect(splitProjection.entries[0]).toEqual(projectionEntry({
      kind: "text",
      eventOrdinal: 0,
      outputIndex: 0,
      itemIndex: 0,
      blockIndex: 0,
      type: "output_text",
      text: "<block>no</block> 🌊",
    }));
    expect(crlfProjection.entries[0]).toEqual(projectionEntry({
      kind: "text",
      eventOrdinal: 0,
      outputIndex: 0,
      itemIndex: 0,
      blockIndex: 0,
      type: "output_text",
      text: "<block>yes</block>",
    }));
  });

  it("preserves duplicate and gap terminal indexes before marking reconciliation malformed", async () => {
    const duplicate = await projectResponsesClassifierStream(
      STAGE_ONE_BODY,
      readableFromChunks([
        doneFrame(textItem("<block>no</block>"), 0),
        doneFrame(textItem("<block>yes</block>"), 0),
        terminalFrame(),
      ]),
    );
    const gap = await projectResponsesClassifierStream(
      STAGE_ONE_BODY,
      readableFromChunks([
        doneFrame(textItem("<block>no</block>"), 1),
        terminalFrame(),
      ]),
    );

    expect(duplicate.entries.slice(0, 2).map((entry) => entry.text)).toEqual([
      "<block>no</block>",
      "<block>yes</block>",
    ]);
    expect(duplicate.entries.some((entry) => entry.kind === "malformed")).toBe(true);
    expect(gap.entries[0].text).toBe("<block>no</block>");
    expect(gap.entries.some((entry) => entry.kind === "malformed")).toBe(true);
  });

  it.each([
    ["missing done item", frame("response.output_item.done", { type: "response.output_item.done", output_index: 0 })],
    ["invalid done index", doneFrame(textItem("<block>no</block>"), -1)],
    ["malformed JSON", "event: response.output_item.done\ndata: {not json}\n\n"],
    ["hidden item on unknown event", frame("response.future", { item: { type: "custom_tool_call", id: "ct_hidden" } })],
  ])("marks malformed terminal SSE %s", async (_name, unsafeFrame) => {
    const projection = await projectResponsesClassifierStream(
      STAGE_ONE_BODY,
      readableFromChunks([unsafeFrame, terminalFrame()]),
    );
    expect(projection.entries.some((entry) => entry.kind === "malformed")).toBe(true);
  });

  it("ignores content-free Responses metadata", async () => {
    const projection = await projectResponsesClassifierStream(
      STAGE_ONE_BODY,
      readableFromChunks([
        frame("response.created", {
          type: "response.created",
          response: { id: "resp_classifier_1700000000", status: "in_progress" },
        }),
        doneFrame(textItem("<block>no</block>")),
        terminalFrame(),
      ]),
    );

    expect(projection.entries).toEqual([
      projectionEntry({
        kind: "text",
        eventOrdinal: 1,
        outputIndex: 0,
        itemIndex: 0,
        blockIndex: 0,
        type: "output_text",
        text: "<block>no</block>",
      }),
    ]);
  });
});

describe("Claude Code response classifier validation", () => {
  it("rejects malformed classifier prose from forced Responses SSE", async () => {
    const result = await handleForcedSSEToJson(
      forcedResponsesContext(STAGE_ONE_BODY, [
        doneFrame(textItem("This looks safe to me.")),
        terminalFrame(),
      ]),
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(await result.response.json()).toEqual(CLASSIFIER_ERROR);
  });

  it.each([
    [
      "an earlier prose message before a final decision",
      [
        doneFrame(textItem("This looks safe to me."), 0),
        doneFrame(textItem("<block>no</block>"), 1),
        terminalFrame(),
      ],
    ],
    [
      "a custom tool item dropped by conversion",
      [
        doneFrame(textItem("<block>no</block>"), 0),
        doneFrame({ type: "custom_tool_call", id: "ct_hidden", name: "shell", input: "pwd" }, 1),
        terminalFrame(),
      ],
    ],
    [
      "an unknown item dropped by conversion",
      [
        doneFrame(textItem("<block>yes</block>"), 0),
        doneFrame({ type: "future_item", id: "future_hidden" }, 1),
        terminalFrame(),
      ],
    ],
    [
      "an unknown message content block dropped by conversion",
      [
        doneFrame({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "<block>yes</block>" }, { type: "future_part" }],
        }, 0),
        terminalFrame(),
      ],
    ],
  ])("rejects raw Responses SSE ambiguity from %s", async (_name, chunks) => {
    const result = await handleForcedSSEToJson(
      forcedResponsesContext(STAGE_ONE_BODY, chunks),
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(await result.response.json()).toEqual(CLASSIFIER_ERROR);
  });

  it("rejects actionable output hidden in recognized metadata", async () => {
    const safeItem = {
      id: "msg_classifier_safe",
      ...textItem("<block>no</block>"),
    };
    const result = await handleForcedSSEToJson(
      forcedResponsesContext(STAGE_ONE_BODY, [
        frame("response.created", {
          type: "response.created",
          response: {
            id: "resp_classifier_1700000000",
            output: [{ id: "ct_hidden", type: "custom_tool_call", name: "shell", input: "pwd" }],
          },
        }),
        doneFrame(safeItem),
        terminalFrame([safeItem]),
      ]),
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(await result.response.json()).toEqual(CLASSIFIER_ERROR);
  });

  it("rejects a blank explicit SSE event instead of falling back to JSON type", async () => {
    const safeItem = {
      id: "msg_classifier_safe",
      ...textItem("<block>no</block>"),
    };
    const blankEventTerminal = `event:\ndata: ${JSON.stringify({
      type: "response.completed",
      response: {
        id: "resp_classifier_1700000000",
        status: "completed",
        output: [safeItem],
        usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 },
      },
    })}\n\n`;
    const result = await handleForcedSSEToJson(
      forcedResponsesContext(STAGE_ONE_BODY, [
        doneFrame(safeItem),
        blankEventTerminal,
      ]),
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(await result.response.json()).toEqual(CLASSIFIER_ERROR);
  });

  it.each([
    [
      "an added custom-tool item without an authoritative terminal item",
      frame("response.output_item.added", {
        type: "response.output_item.added",
        output_index: 1,
        item: { id: "ct_hidden", type: "custom_tool_call", name: "shell", input: "pwd" },
      }),
    ],
    [
      "an added unknown content part without an authoritative terminal block",
      frame("response.content_part.added", {
        type: "response.content_part.added",
        output_index: 0,
        item_id: "msg_classifier_safe",
        content_index: 1,
        part: { type: "unknown_part" },
      }),
    ],
    [
      "a function-call argument fragment without an authoritative call",
      frame("response.function_call_arguments.delta", {
        type: "response.function_call_arguments.delta",
        output_index: 1,
        item_id: "fc_hidden",
        delta: "{\"cmd\":\"pwd\"}",
      }),
    ],
    [
      "a custom-tool input fragment without an authoritative custom tool",
      frame("response.custom_tool_call_input.delta", {
        type: "response.custom_tool_call_input.delta",
        output_index: 1,
        item_id: "ct_hidden",
        delta: "pwd",
      }),
    ],
    [
      "an output-text fragment with a conflicting item identity",
      frame("response.output_text.delta", {
        type: "response.output_text.delta",
        output_index: 0,
        item_id: "msg_wrong",
        content_index: 0,
        delta: "<block>yes</block>",
      }),
    ],
  ])("rejects unresolved Responses transport evidence from %s", async (_name, fragment) => {
    const safeItem = {
      id: "msg_classifier_safe",
      ...textItem("<block>no</block>"),
    };
    const result = await handleForcedSSEToJson(
      forcedResponsesContext(STAGE_ONE_BODY, [
        fragment,
        terminalFrame([safeItem]),
      ]),
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(await result.response.json()).toEqual(CLASSIFIER_ERROR);
  });
});
