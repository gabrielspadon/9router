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
        ...STAGE_ONE_BODY,
        stream: undefined,
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
      { ...STAGE_TWO_BODY, stream: undefined, stop_sequences: [] },
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

  it.each([true, null, "false", 0, [], {}])(
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
});
