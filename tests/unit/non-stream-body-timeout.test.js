import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const coreMocks = vi.hoisted(() => ({ handleChatCore: vi.fn() }));
const usageMocks = vi.hoisted(() => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
}));

vi.mock("../../open-sse/handlers/chatCore.js", () => coreMocks);
vi.mock("@/lib/usageDb.js", () => usageMocks);

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { RESPONSE_BODY_TIMEOUT_MS } = await import("../../open-sse/config/runtimeConfig.js");
const { BodyReadTimeoutError } = await import("../../open-sse/utils/bodyTimeout.js");
const { CallerAbortError } = await import("../../open-sse/utils/error.js");
const { handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");
const { handleResponsesCore } = await import("../../open-sse/handlers/responsesHandler.js");

function responseWithBodyError(error, contentType = "application/json") {
  return new Response(new ReadableStream({
    start(controller) {
      controller.error(error);
    },
  }), { headers: { "content-type": contentType } });
}

function stallingResponse(contentType) {
  const events = { cancel: [] };
  const body = new ReadableStream({
    cancel(reason) {
      events.cancel.push(reason);
    },
  });
  return { response: new Response(body, { headers: { "content-type": contentType } }), events };
}

function commonContext(overrides = {}) {
  return {
    provider: "codex",
    model: "gpt-5.6-sol",
    body: { model: "codex/gpt-5.6-sol", messages: [{ role: "user", content: "hello" }] },
    stream: false,
    sourceFormat: FORMATS.OPENAI,
    targetFormat: FORMATS.OPENAI,
    translatedBody: {},
    finalBody: {},
    requestStartTime: Date.now(),
    connectionId: "connection-a",
    clientRawRequest: { endpoint: "/v1/chat/completions", body: { model: "codex/gpt-5.6-sol" } },
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    reqLogger: {
      logProviderResponse: vi.fn(),
      logConvertedResponse: vi.fn(),
    },
    log: { line: vi.fn(), warn: vi.fn() },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("non-stream body failures", () => {
  it.each([
    ["ordinary JSON", "generic", FORMATS.OPENAI, FORMATS.OPENAI, "application/json"],
    ["forced Chat SSE", "generic", FORMATS.OPENAI, FORMATS.OPENAI, "text/event-stream"],
    ["forced Gemini SSE", "gemini", FORMATS.OPENAI, FORMATS.GEMINI, "text/event-stream"],
    ["forced Responses SSE", "codex", FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "text/event-stream"],
  ])("maps a %s body deadline to 504 without success callbacks", async (_name, provider, sourceFormat, targetFormat, contentType) => {
    const ctx = commonContext({
      provider,
      sourceFormat,
      targetFormat,
      providerResponse: responseWithBodyError(new BodyReadTimeoutError(1000), contentType),
      onRequestSuccess: vi.fn(),
    });

    const result = contentType === "application/json"
      ? await handleNonStreamingResponse(ctx)
      : await handleForcedSSEToJson(ctx);

    expect(result).toMatchObject({ success: false, status: 504 });
    expect(ctx.onRequestSuccess).not.toHaveBeenCalled();
    expect(ctx.trackDone).not.toHaveBeenCalled();
  });

  it.each([
    ["ordinary JSON", "generic", FORMATS.OPENAI, FORMATS.OPENAI, "application/json"],
    ["forced Chat SSE", "generic", FORMATS.OPENAI, FORMATS.OPENAI, "text/event-stream"],
    ["forced Gemini SSE", "gemini", FORMATS.OPENAI, FORMATS.GEMINI, "text/event-stream"],
    ["forced Responses SSE", "codex", FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "text/event-stream"],
  ])("owns and cancels a stalled %s reader at the body deadline", async (_name, provider, sourceFormat, targetFormat, contentType) => {
    vi.useFakeTimers();
    const stalled = stallingResponse(contentType);
    const ctx = commonContext({
      provider,
      sourceFormat,
      targetFormat,
      providerResponse: stalled.response,
      onRequestSuccess: vi.fn(),
    });
    const pending = contentType === "application/json"
      ? handleNonStreamingResponse(ctx)
      : handleForcedSSEToJson(ctx);
    const settled = expect(pending).resolves.toMatchObject({ success: false, status: 504 });

    await vi.advanceTimersByTimeAsync(RESPONSE_BODY_TIMEOUT_MS);
    await settled;

    expect(stalled.events.cancel).toHaveLength(1);
    expect(stalled.events.cancel[0]).toBeInstanceOf(BodyReadTimeoutError);
    expect(ctx.onRequestSuccess).not.toHaveBeenCalled();
    expect(ctx.trackDone).not.toHaveBeenCalled();
  });

  it("maps an already-aborted caller to 499 without completion work", async () => {
    const caller = new AbortController();
    const reason = new DOMException("client left", "AbortError");
    caller.abort(reason);
    const ctx = commonContext({
      callerSignal: caller.signal,
      providerResponse: responseWithBodyError(new CallerAbortError(reason)),
      onRequestSuccess: vi.fn(),
    });

    const result = await handleNonStreamingResponse(ctx);

    expect(result).toMatchObject({ success: false, status: 499, clientAborted: true });
    expect(ctx.onRequestSuccess).not.toHaveBeenCalled();
    expect(ctx.trackDone).not.toHaveBeenCalled();
  });

  it("does not treat an unrelated reader error as client cancellation", async () => {
    const ctx = commonContext({
      providerResponse: responseWithBodyError(new CallerAbortError(new Error("unrelated reader failure"))),
    });

    const result = await handleNonStreamingResponse(ctx);

    expect(result).toMatchObject({ success: false, status: 502 });
  });

  it("keeps malformed JSON as an ordinary 502", async () => {
    const ctx = commonContext({ providerResponse: new Response("not-json") });

    const result = await handleNonStreamingResponse(ctx);

    expect(result).toMatchObject({ success: false, status: 502 });
  });

  it("maps a Responses endpoint forced-SSE body deadline to 504", async () => {
    coreMocks.handleChatCore.mockResolvedValue({
      success: true,
      response: responseWithBodyError(new BodyReadTimeoutError(1000), "text/event-stream"),
    });

    const result = await handleResponsesCore({
      body: { model: "codex/gpt-5.6-sol", input: "hello", stream: false },
      modelInfo: { provider: "codex", model: "gpt-5.6-sol" },
      credentials: {},
      callerSignal: new AbortController().signal,
    });

    expect(result).toMatchObject({ success: false, status: 504 });
    expect(coreMocks.handleChatCore.mock.calls[0][0].callerSignal).toBeDefined();
  });
});
