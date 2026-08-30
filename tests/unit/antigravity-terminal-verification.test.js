import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ saveRequestDetail: vi.fn(), appendRequestLog: vi.fn() }));
vi.mock("@/lib/usageDb.js", () => ({
  saveRequestDetail: mocks.saveRequestDetail,
  appendRequestLog: mocks.appendRequestLog,
}));
vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", () => ({
  buildRequestDetail: vi.fn((detail, extra = {}) => ({ ...detail, ...extra })),
  extractRequestConfig: vi.fn(() => ({})),
  extractUsageFromResponse: vi.fn(() => ({})),
  saveUsageStats: vi.fn(),
  formatDoneLine: vi.fn(() => "done"),
}));

const { handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");
const { buildOnStreamComplete, handleStreamingResponse } = await import("../../open-sse/handlers/chatCore/streamingHandler.js");

const VALIDATION_URLS = [
  "https://accounts.google.com/AccountChooser?opaque=project-secret",
  "https://accounts.google.com/v3/signin/challenge/pwd?opaque=onboard-secret",
];

function usefulBody(content = "completed") {
  return { choices: [{ message: { content }, finish_reason: "stop" }] };
}

function terminalSpy() {
  return vi.fn();
}

function nonStreamingCtx(providerResponse, notify = terminalSpy(), reqLogger = null) {
  return {
    providerResponse,
    provider: "antigravity",
    model: "gemini-3.7-flash",
    sourceFormat: "openai",
    targetFormat: "openai",
    body: { model: "gemini-3.7-flash", stream: false },
    stream: false,
    translatedBody: {}, finalBody: {}, requestStartTime: Date.now(), connectionId: "conn-terminal", apiKey: "key",
    clientRawRequest: { endpoint: "/v1/chat/completions", body: {} }, onRequestSuccess: vi.fn(),
    onVerificationSuccess: notify, notifyTerminalVerificationSuccess: notify,
    reqLogger: reqLogger || { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() }, toolNameMap: null, customToolNames: null,
    trackDone: vi.fn(), appendLog: vi.fn(), pxpipe: null, reqTag: "TERM", log: { line: vi.fn(), warn: vi.fn() },
  };
}

function forcedCtx(providerResponse, notify = terminalSpy()) {
  return {
    providerResponse, provider: "antigravity", model: "gemini-3.7-flash", sourceFormat: "openai", targetFormat: "openai",
    body: { model: "gemini-3.7-flash", stream: false }, stream: false, translatedBody: {}, finalBody: {}, requestStartTime: Date.now(),
    connectionId: "conn-terminal", apiKey: "key", clientRawRequest: { endpoint: "/v1/chat/completions", body: {} },
    onRequestSuccess: vi.fn(), onVerificationSuccess: notify, notifyTerminalVerificationSuccess: notify,
    customToolNames: null, trackDone: vi.fn(), appendLog: vi.fn(), reqTag: "TERM", log: { line: vi.fn() },
  };
}

function streamCtx(notify = terminalSpy()) {
  return {
    provider: "antigravity", model: "gemini-3.7-flash", connectionId: "conn-terminal", apiKey: "key", requestStartTime: Date.now(),
    body: {}, stream: true, finalBody: null, translatedBody: null, clientRawRequest: { endpoint: "/v1/chat/completions", body: {} },
    pxpipe: null, reqTag: "TERM", log: { line: vi.fn(), warn: vi.fn() },
    onVerificationSuccess: notify, notifyTerminalVerificationSuccess: notify,
  };
}

function sseResponse(text) {
  return new Response(text, { headers: { "content-type": "text/event-stream" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.saveRequestDetail.mockResolvedValue(undefined);
  mocks.appendRequestLog.mockResolvedValue(undefined);
});

describe("Antigravity terminal verification success", () => {
  it("notifies verification only after useful non-stream output", async () => {
    const notify = terminalSpy();
    await expect(handleNonStreamingResponse(nonStreamingCtx(new Response(JSON.stringify(usefulBody()), { headers: { "content-type": "application/json" } }), notify))).resolves.toMatchObject({ success: true });
    expect(notify).toHaveBeenCalledOnce();
  });

  it("does not notify from malformed non-stream JSON", async () => {
    const notify = terminalSpy();
    await handleNonStreamingResponse(nonStreamingCtx(new Response("not json", { headers: { "content-type": "application/json" } }), notify));
    expect(notify).not.toHaveBeenCalled();
  });

  it("redacts disguised HTTP-200 structured errors before non-stream sinks", async () => {
    const notify = terminalSpy();
    const logger = { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() };
    const disguised = {
      error: {
        code: 403,
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            domain: "cloudcode-pa.googleapis.com",
            reason: "VALIDATION_REQUIRED",
          },
          { "@type": "type.googleapis.com/google.rpc.Help", links: VALIDATION_URLS.map((url) => ({ url })) },
        ],
      },
    };
    await handleNonStreamingResponse(nonStreamingCtx(new Response(JSON.stringify(disguised), { headers: { "content-type": "application/json" } }), notify, logger));
    expect(notify).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.logProviderResponse.mock.calls)).not.toContain(VALIDATION_URLS[0]);
    expect(JSON.stringify(logger.logProviderResponse.mock.calls)).not.toContain("project-secret");
    expect(JSON.stringify(logger.logProviderResponse.mock.calls)).not.toContain("onboard-secret");
  });

  it("does not notify from an empty non-stream response", async () => {
    const notify = terminalSpy();
    await handleNonStreamingResponse(nonStreamingCtx(new Response(JSON.stringify(usefulBody("")), { headers: { "content-type": "application/json" } }), notify));
    expect(notify).not.toHaveBeenCalled();
  });

  it("notifies verification after useful forced SSE-to-JSON output", async () => {
    const notify = terminalSpy();
    const sse = `data: ${JSON.stringify({ id: "chatcmpl-1", choices: [{ delta: { content: "complete" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
    await expect(handleForcedSSEToJson(forcedCtx(sseResponse(sse), notify))).resolves.toMatchObject({ success: true });
    expect(notify).toHaveBeenCalledOnce();
  });

  it("does not notify from malformed forced SSE-to-JSON output", async () => {
    const notify = terminalSpy();
    await handleForcedSSEToJson(forcedCtx(sseResponse("data: malformed\n\n"), notify));
    expect(notify).not.toHaveBeenCalled();
  });

  it("keeps first valid stream event limited to account-health success", async () => {
    const notify = terminalSpy();
    const accountHealth = vi.fn();
    const response = {
      status: 200,
      headers: new Headers({ "content-type": "text/event-stream" }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "first" } }] })}\n\n`));
          controller.close();
        },
      }),
    };
    const result = await handleStreamingResponse({
      providerResponse: response, provider: "antigravity", model: "gemini-3.7-flash", sourceFormat: "openai", targetFormat: "openai",
      userAgent: "test", body: { stream: true }, stream: true, translatedBody: {}, finalBody: {}, requestStartTime: Date.now(),
      connectionId: "conn-terminal", apiKey: "key", clientRawRequest: null, onRequestSuccess: accountHealth,
      onVerificationSuccess: notify, reqLogger: { logTargetRequest: vi.fn(), logError: vi.fn() }, toolNameMap: null, customToolNames: null,
      streamController: { signal: new AbortController().signal, isConnected: () => true, handleComplete: vi.fn(), handleDisconnect: vi.fn(), handleError: vi.fn() }, onStreamComplete: vi.fn(), streamDetailId: "stream-1", streamState: {},
      pxpipe: null, reqTag: "TERM", log: { line: vi.fn(), warn: vi.fn(), errorLine: vi.fn() },
    });
    await result.response.body.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(accountHealth).toHaveBeenCalledOnce();
    expect(notify).not.toHaveBeenCalled();
  });

  it("notifies at non-aborted terminal text completion", () => {
    const notify = terminalSpy();
    const { onStreamComplete } = buildOnStreamComplete(streamCtx(notify));
    onStreamComplete({ content: "terminal text" }, { completion_tokens: 0 }, Date.now());
    expect(notify).toHaveBeenCalledOnce();
  });

  it("notifies at non-aborted terminal thinking completion", () => {
    const notify = terminalSpy();
    const { onStreamComplete } = buildOnStreamComplete(streamCtx(notify));
    onStreamComplete({ thinking: "terminal reasoning" }, { completion_tokens: 0 }, Date.now());
    expect(notify).toHaveBeenCalledOnce();
  });

  it("notifies at non-aborted terminal output-token completion", () => {
    const notify = terminalSpy();
    const { onStreamComplete } = buildOnStreamComplete(streamCtx(notify));
    onStreamComplete({}, { completion_tokens: 3 }, Date.now());
    expect(notify).toHaveBeenCalledOnce();
  });

  it("does not notify at empty EOF", () => {
    const notify = terminalSpy();
    const { onStreamComplete } = buildOnStreamComplete(streamCtx(notify));
    onStreamComplete({}, { completion_tokens: 0 }, Date.now());
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not notify from an aborted completion", () => {
    const notify = terminalSpy();
    const { onStreamComplete } = buildOnStreamComplete(streamCtx(notify));
    onStreamComplete({ content: "cancelled" }, { completion_tokens: 2 }, Date.now(), { aborted: true });
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not notify from abandoned streams", () => {
    const notify = terminalSpy();
    const { onStreamAbandoned } = buildOnStreamComplete(streamCtx(notify));
    onStreamAbandoned("upstream reset");
    expect(notify).not.toHaveBeenCalled();
  });

  it("notifies terminal verification at most once", () => {
    const notify = terminalSpy();
    const { onStreamComplete } = buildOnStreamComplete(streamCtx(notify));
    onStreamComplete({ content: "once" }, { completion_tokens: 1 }, Date.now());
    onStreamComplete({ content: "twice" }, { completion_tokens: 1 }, Date.now());
    expect(notify).toHaveBeenCalledOnce();
  });
});
