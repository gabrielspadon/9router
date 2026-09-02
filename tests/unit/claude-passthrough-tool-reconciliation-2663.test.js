import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, nonStreamingMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  nonStreamingMock: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: executeMock }),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock("../../open-sse/handlers/chatCore/nonStreamingHandler.js", () => ({
  handleNonStreamingResponse: nonStreamingMock,
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { normalizeClaudePassthrough } = await import("../../open-sse/translator/formats/claude.js");

const log = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  line: vi.fn(),
  tagForSession: () => "CLAUDE",
  fmtThink: () => null,
};

function nativeBody(messages, extra = {}) {
  return {
    model: "claude-sonnet-4-6",
    anthropic_version: "2023-06-01",
    max_tokens: 512,
    stream: false,
    messages,
    ...extra,
  };
}

async function runNativeClaude(messages, extra = {}) {
  const body = nativeBody(messages, extra);
  await handleChatCore({
    body,
    modelInfo: { provider: "claude", model: "claude-sonnet-4-6" },
    credentials: { apiKey: "test-key", providerSpecificData: {} },
    connectionId: "claude-connection",
    log,
    rtkEnabled: false,
    headroomEnabled: false,
    cavemanEnabled: false,
    ponytailEnabled: false,
    pxpipeEnabled: false,
    clientRawRequest: {
      endpoint: "/v1/messages",
      body,
      headers: { "user-agent": "claude-cli/2.1.0", accept: "application/json" },
    },
  });
  return { inbound: body, outbound: executeMock.mock.calls.at(-1)[0].body };
}

const toolUse = (id, name = "read_file") => ({ type: "tool_use", id, name, input: {} });
const toolResult = (id, content) => ({ type: "tool_result", tool_use_id: id, content });

beforeEach(() => {
  vi.clearAllMocks();
  executeMock.mockResolvedValue({
    response: new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), { status: 200 }),
    url: "https://api.anthropic.com/v1/messages",
    headers: {},
    transformedBody: null,
  });
  nonStreamingMock.mockResolvedValue({ success: true, response: new Response("{}") });
});

describe("native Claude passthrough tool-result reconciliation (#2663)", () => {
  it("reconciles valid, missing, and orphaned results before the native Claude executor", async () => {
    const { outbound } = await runNativeClaude([
      { role: "user", content: [{ type: "text", text: "run the tools" }] },
      {
        role: "assistant",
        content: [toolUse("call-first"), toolUse("call-second", "grep"), toolUse("call-missing", "list")],
      },
      {
        role: "user",
        content: [
          toolResult("call-second", "second output"),
          toolResult("call-first", "first output"),
          toolResult("call-orphan", "orphan output"),
        ],
      },
    ]);

    const resultTurn = outbound.messages[2].content;
    const structured = resultTurn.filter((block) => block.type === "tool_result");
    expect(structured.map((block) => block.tool_use_id)).toEqual(["call-first", "call-second", "call-missing"]);
    expect(structured.map((block) => block.content)).toEqual(["first output", "second output", ""]);
    expect(resultTurn.find((block) => block.type === "text")?.text).toContain("orphan output");
  });

  it("normalizes only known nested models at the native executor boundary without mutating fallback input", async () => {
    const tools = [
      {
        type: "advisor_20260301",
        name: "advisor",
        model: "cc/claude-opus-4-8",
        input_schema: { type: "object", properties: { question: { type: "string" } } },
      },
      {
        name: "Task",
        description: "Launch a subagent",
        model: "claude/claude-haiku-4-5",
        input_schema: { type: "object", required: ["prompt"] },
      },
      { name: "KnownElsewhere", model: "openrouter/anthropic/claude-sonnet-5", input_schema: { type: "object" } },
      { name: "Custom", model: "some-vendor/their-model", input_schema: { type: "object" } },
      { name: "PrototypeNamed", model: "constructor/acme", input_schema: { type: "object" } },
      { name: "Missing", input_schema: { type: "object" } },
      { name: "Numeric", model: 42, input_schema: { type: "object" } },
    ];
    const original = JSON.parse(JSON.stringify(tools));

    const { inbound, outbound } = await runNativeClaude(
      [{ role: "user", content: [{ type: "text", text: "Delegate this task." }] }],
      { tools },
    );

    expect(outbound.tools.map((tool) => tool.model)).toEqual([
      "claude-opus-4-8",
      "claude-haiku-4-5",
      "anthropic/claude-sonnet-5",
      "some-vendor/their-model",
      "constructor/acme",
      undefined,
      42,
    ]);
    expect(outbound.tools[0]).toMatchObject({
      type: "advisor_20260301",
      name: "advisor",
      input_schema: { type: "object", properties: { question: { type: "string" } } },
    });
    expect(outbound.tools[1]).toMatchObject({
      name: "Task",
      description: "Launch a subagent",
      input_schema: { type: "object", required: ["prompt"] },
    });
    expect(inbound.tools).toEqual(original);
  });

  it("does not mutate caller state reused by an account fallback", () => {
    const messages = [
      { role: "assistant", content: [toolUse("call-first"), toolUse("call-missing")] },
      {
        role: "user",
        content: [toolResult("call-first", "first output"), toolResult("call-orphan", "orphan output")],
      },
    ];
    const callerBody = {
      ...nativeBody(messages),
      output_config: { effort: "high", preserve: true },
    };
    const original = JSON.parse(JSON.stringify(callerBody));

    normalizeClaudePassthrough({ ...callerBody }, "claude-haiku-4-5");

    expect(callerBody).toEqual(original);
  });

  it("keeps only the first duplicate result structured and salvages the later text", () => {
    const body = nativeBody([
      { role: "assistant", content: [toolUse("call-1")] },
      { role: "user", content: [toolResult("call-1", "first"), toolResult("call-1", "duplicate")] },
    ]);

    const out = normalizeClaudePassthrough(body, body.model);
    const content = out.messages[1].content;

    expect(content.filter((block) => block.type === "tool_result")).toMatchObject([
      { tool_use_id: "call-1", content: "first" },
    ]);
    expect(content.find((block) => block.type === "text")?.text).toContain("duplicate");
  });

  it("keeps matching media and never stringifies orphaned media", () => {
    const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "MATCHED" } };
    const orphanImage = { type: "image", source: { type: "base64", media_type: "image/png", data: "ORPHAN" } };
    const body = nativeBody([
      { role: "assistant", content: [toolUse("call-image")] },
      {
        role: "user",
        content: [
          toolResult("call-image", [image]),
          toolResult("call-orphan", [orphanImage]),
        ],
      },
    ]);

    const out = normalizeClaudePassthrough(body, body.model);
    const serialized = JSON.stringify(out.messages[1].content);

    expect(out.messages[1].content.find((block) => block.type === "tool_result")?.content).toEqual([image]);
    expect(serialized).not.toContain("ORPHAN");
    expect(serialized).toContain("Unpaired tool result call-orphan");
  });

  it("does not re-pair a result across an intervening assistant turn", () => {
    const body = nativeBody([
      { role: "assistant", content: [toolUse("old-call")] },
      { role: "user", content: [{ type: "text", text: "continue" }] },
      { role: "assistant", content: [{ type: "text", text: "new turn" }] },
      { role: "user", content: [toolResult("old-call", "late output")] },
    ]);

    const out = normalizeClaudePassthrough(body, body.model);
    const finalTurn = out.messages.at(-1).content;

    expect(finalTurn.some((block) => block.type === "tool_result")).toBe(false);
    expect(finalTurn[0].text).toContain("late output");
  });

  it("does not treat a folded system message as the tool-result turn", () => {
    const body = nativeBody([
      { role: "assistant", content: [toolUse("old-call")] },
      { role: "system", content: "intervening system instruction" },
      { role: "user", content: [toolResult("old-call", "late output")] },
    ]);

    const out = normalizeClaudePassthrough(body, body.model);

    expect(out.messages.flatMap((message) => message.content).some((block) => block.type === "tool_result")).toBe(false);
    expect(out.messages.every((message, index) => index === 0 || message.role !== out.messages[index - 1].role)).toBe(true);
    expect(out.messages.at(-1).content.some((block) => block.text?.includes("late output"))).toBe(true);
  });
});
