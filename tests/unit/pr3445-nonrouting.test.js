import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { convertResponsesStreamToJson } =
  await import("../../open-sse/transformer/streamToJsonConverter.js");
const { handleForcedSSEToJson } =
  await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");
const { openaiToOpenAIResponsesRequest } =
  await import("../../open-sse/translator/request/openai-responses.js");
const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
const { getModelTargetFormat, getModelSupportedFormats } =
  await import("../../open-sse/config/providerModels.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");

function sseStream(events) {
  const encoder = new TextEncoder();
  const body = events
    .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join("");
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
}

const DONE_ITEM = {
  type: "response.output_item.done",
  output_index: 0,
  item: {
    id: "msg_1",
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: "partial" }],
  },
};

describe("PR 3445 non-routing port", () => {
  it("convertResponsesStreamToJson preserves status:incomplete + incomplete_details", async () => {
    const out = await convertResponsesStreamToJson(
      sseStream([
        DONE_ITEM,
        {
          type: "response.completed",
          response: {
            id: "resp_1",
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" },
            usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
          },
        },
      ]),
    );
    expect(out.status).toBe("incomplete");
    expect(out.incomplete_details).toEqual({ reason: "max_output_tokens" });
    expect(out.output[0].content[0].text).toBe("partial");
  });

  const forcedCtx = (sourceFormat) => ({
    providerResponse: new Response(
      sseStream([
        {
          type: "response.created",
          response: { id: "resp_tr", status: "in_progress" },
        },
        DONE_ITEM,
        {
          type: "response.completed",
          response: {
            id: "resp_tr",
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" },
            usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
          },
        },
      ]),
      { headers: { "content-type": "text/event-stream" } },
    ),
    sourceFormat,
    targetFormat: FORMATS.OPENAI_RESPONSES,
    provider: "codex",
    model: "gpt-5.5",
    body: { model: "gpt-5.5", input: "hello" },
    stream: false,
    requestStartTime: Date.now(),
    connectionId: "test-connection",
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    trackDone: vi.fn(),
    appendLog: vi.fn(),
  });

  it("SSE-to-JSON emits finish_reason length on max_output_tokens truncation (chat client)", async () => {
    const result = await handleForcedSSEToJson(forcedCtx(FORMATS.OPENAI));
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.choices[0].finish_reason).toBe("length");
  });

  it("SSE-to-JSON emits stop_reason max_tokens on truncation (claude client)", async () => {
    const result = await handleForcedSSEToJson(forcedCtx(FORMATS.CLAUDE));
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.type).toBe("message");
    expect(json.stop_reason).toBe("max_tokens");
  });

  it("translator respects stream:false instead of hardcoding stream:true", () => {
    const out = openaiToOpenAIResponsesRequest(
      "m",
      { messages: [{ role: "user", content: "hi" }] },
      false,
      {},
    );
    expect(out.stream).toBe(false);
    const passthrough = openaiToOpenAIResponsesRequest(
      "m",
      { input: [{ type: "message", role: "user", content: "hi" }] },
      false,
      {},
    );
    expect(passthrough.stream).toBe(false);
    const defaultOn = openaiToOpenAIResponsesRequest(
      "m",
      { messages: [{ role: "user", content: "hi" }] },
      undefined,
      {},
    );
    expect(defaultOn.stream).toBe(true);
  });

  it("translator maps max_tokens to max_output_tokens with precedence", () => {
    const out = openaiToOpenAIResponsesRequest(
      "m",
      { messages: [], max_tokens: 100 },
      true,
      {},
    );
    expect(out.max_tokens).toBeUndefined();
    expect(out.max_output_tokens).toBe(100);
    const passthrough = openaiToOpenAIResponsesRequest(
      "m",
      { input: [], max_output_tokens: 50, max_tokens: 100 },
      true,
      {},
    );
    expect(passthrough.max_output_tokens).toBe(50);
    expect(passthrough.max_tokens).toBeUndefined();
  });

  it("translator normalizes tool_choice to Responses shape", () => {
    const chatFn = openaiToOpenAIResponsesRequest(
      "m",
      {
        messages: [],
        tool_choice: { type: "function", function: { name: "shell" } },
      },
      true,
      {},
    );
    expect(chatFn.tool_choice).toEqual({ type: "function", name: "shell" });
    const claudeAny = openaiToOpenAIResponsesRequest(
      "m",
      { messages: [], tool_choice: { type: "any" } },
      true,
      {},
    );
    expect(claudeAny.tool_choice).toBe("required");
    const string = openaiToOpenAIResponsesRequest(
      "m",
      { messages: [], tool_choice: "auto" },
      true,
      {},
    );
    expect(string.tool_choice).toBe("auto");
  });

  it("opencode-go muse demotes forced tool_choice to auto (with and without suffix)", () => {
    const executor = new DefaultExecutor("opencode-go");
    const forced = {
      messages: [{ role: "user", content: "hi" }],
      tool_choice: { type: "function", function: { name: "web_search" } },
    };
    const bare = executor.transformRequest(
      "muse-spark-1.2-contributor",
      structuredClone(forced),
      true,
      {},
    );
    expect(bare.tool_choice).toBe("auto");
    const suffixed = executor.transformRequest(
      "muse-spark-1.2-contributor(high)",
      structuredClone(forced),
      true,
      {},
    );
    expect(suffixed.tool_choice).toBe("auto");
    const other = executor.transformRequest(
      "glm-5.2",
      structuredClone(forced),
      true,
      {},
    );
    expect(other.tool_choice).toEqual({
      type: "function",
      function: { name: "web_search" },
    });
  });

  it("providerModels resolves formats/targetFormat through a thinking suffix", () => {
    const bareFormats = getModelSupportedFormats(
      "opencode-go",
      "deepseek-v4-pro",
    );
    expect(bareFormats).toBeTruthy();
    expect(
      getModelSupportedFormats("opencode-go", "deepseek-v4-pro(high)"),
    ).toEqual(bareFormats);
    expect(getModelTargetFormat("opencode-go", "deepseek-v4-pro(high)")).toBe(
      getModelTargetFormat("opencode-go", "deepseek-v4-pro"),
    );
  });
});
