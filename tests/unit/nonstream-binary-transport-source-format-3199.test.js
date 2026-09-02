import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));
vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", () => ({
  buildRequestDetail: vi.fn((detail) => detail),
  extractRequestConfig: vi.fn(() => ({})),
  extractUsageFromResponse: vi.fn((response) => response?.usage || {}),
  saveUsageStats: vi.fn(),
  formatDoneLine: vi.fn(() => "done"),
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleNonStreamingResponse, translateNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");

const DECODED_OPENAI_BODY = {
  id: "chatcmpl-binary",
  object: "chat.completion",
  created: 1700000000,
  model: "kr/claude-haiku-4-5",
  choices: [{
    index: 0,
    message: { role: "assistant", content: "hello from a decoded binary transport" },
    finish_reason: "stop"
  }],
  usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }
};

describe("non-streaming decoded binary transport replies", () => {
  it("translates a decoded OpenAI completion to an Anthropic Message for a Claude client", () => {
    const out = translateNonStreamingResponse(DECODED_OPENAI_BODY, FORMATS.KIRO, FORMATS.CLAUDE);

    expect(out).toMatchObject({
      type: "message",
      role: "assistant",
      stop_reason: "end_turn",
      usage: { input_tokens: 11, output_tokens: 7 },
    });
    expect(out.content).toEqual([{ type: "text", text: "hello from a decoded binary transport" }]);
  });

  it("translates a decoded OpenAI completion to a Responses body for a Responses client", () => {
    const out = translateNonStreamingResponse(DECODED_OPENAI_BODY, FORMATS.KIRO, FORMATS.OPENAI_RESPONSES);

    expect(out).toMatchObject({ object: "response", status: "completed" });
    expect(out.output).toEqual([{
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "hello from a decoded binary transport", annotations: [] }],
    }]);
  });

  it("keeps an OpenAI client completion unchanged", () => {
    expect(translateNonStreamingResponse(DECODED_OPENAI_BODY, FORMATS.KIRO, FORMATS.OPENAI)).toBe(DECODED_OPENAI_BODY);
  });

  it("leaves an unrecognized decoded binary body untouched", () => {
    const body = { result: "not a chat completion" };
    expect(translateNonStreamingResponse(body, FORMATS.KIRO, FORMATS.CLAUDE)).toBe(body);
  });

  it("returns the Anthropic message through the non-streaming handler", async () => {
    const result = await handleNonStreamingResponse({
      providerResponse: new Response(JSON.stringify(DECODED_OPENAI_BODY), { headers: { "content-type": "application/json" } }),
      provider: "kiro",
      model: "claude-haiku-4-5",
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.KIRO,
      body: { model: "kr/claude-haiku-4-5", stream: false },
      stream: false,
      translatedBody: {},
      finalBody: {},
      requestStartTime: Date.now(),
      connectionId: "kiro-connection",
      apiKey: "test-key",
      clientRawRequest: { endpoint: "/v1/messages", body: { model: "kr/claude-haiku-4-5" } },
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      toolNameMap: null,
      customToolNames: null,
      trackDone: vi.fn(),
      appendLog: vi.fn(),
      pxpipe: null,
      reqTag: "TEST",
      log: { line: vi.fn(), warn: vi.fn() },
    });

    expect(result.success).toBe(true);
    await expect(result.response.json()).resolves.toMatchObject({
      type: "message",
      content: [{ type: "text", text: "hello from a decoded binary transport" }],
    });
  });
});
