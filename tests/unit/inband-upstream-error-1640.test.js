// #1640 — Qoder answers HTTP 200 and puts its 413 (oversized request) into the
// assistant content as `[qoder error 413: ...]`. The pre-client peek already
// detected it, but the handler only logged the detection and piped the stream
// on, so the client received the error string as the model's answer and no
// fallback ever fired. combo.js treats the same class of in-band error as a
// failure; the single-account streaming path now does too.
import { beforeEach, describe, expect, it, vi } from "vitest";

const saveRequestDetail = vi.fn(() => Promise.resolve());

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestDetail,
  saveRequestUsage: vi.fn(() => Promise.resolve()),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  trackPendingRequest: vi.fn(),
}));

const { handleStreamingResponse } = await import("open-sse/handlers/chatCore/streamingHandler.js");

function sseResponse(chunks) {
  const headers = new Map();
  headers.get = (k) => (k.toLowerCase() === "content-type" ? "text/event-stream" : null);
  return {
    status: 200,
    headers,
    text: async () => chunks.join(""),
    body: new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    }),
  };
}

function contentFrame(text) {
  return `data: ${JSON.stringify({
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
  })}\n\n`;
}

const baseParams = {
  provider: "qoder",
  model: "claude-sonnet-4.5",
  sourceFormat: "openai",
  targetFormat: "openai",
  userAgent: "test-agent",
  body: { stream: true, model: "claude-sonnet-4.5", messages: [{ role: "user", content: "hi" }] },
  translatedBody: { model: "upstream-id" },
  finalBody: { model: "upstream-id" },
  requestStartTime: Date.now(),
  connectionId: "conn-1640",
  apiKey: "k",
  clientRawRequest: null,
  reqLogger: { logTargetRequest: () => {}, logError: () => {} },
  toolNameMap: null,
  customToolNames: null,
  onStreamComplete: vi.fn(),
  streamDetailId: "detail-1640",
  pxpipe: null,
  reqTag: "REQ_1640",
};

function params(overrides) {
  return {
    ...baseParams,
    streamController: {
      signal: new AbortController().signal,
      isConnected: () => true,
      handleComplete: vi.fn(),
      handleError: vi.fn(),
      handleDisconnect: vi.fn(),
      abort: vi.fn(),
    },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), errorLine: vi.fn(), line: vi.fn() },
    ...overrides,
  };
}

describe("#1640 an oversized-request error carried in the stream fails the request", () => {
  beforeEach(() => saveRequestDetail.mockClear());

  it("returns the upstream's own status instead of piping the error as content", async () => {
    const p = params({
      providerResponse: sseResponse([contentFrame("[qoder error 413: request payload too large]")]),
    });
    const res = await handleStreamingResponse(p);

    expect(res.success).toBe(false);
    expect(res.status).toBe(413);
    expect(res.error).toMatch(/qoder upstream error/i);
    expect(p.streamController.handleError).toHaveBeenCalledTimes(1);
  });

  it("records the failure so it is inspectable like any other failed request", async () => {
    const res = await handleStreamingResponse(
      params({ providerResponse: sseResponse([contentFrame("[qoder error 413: request payload too large]")]) }),
    );

    expect(saveRequestDetail).toHaveBeenCalledTimes(1);
    expect(saveRequestDetail.mock.calls[0][0]).toMatchObject({
      id: "detail-1640",
      status: "error",
      response: { status: 413 },
    });
    await expect(res.response.json()).resolves.toEqual({
      error: { message: `[413]: ${res.error}` },
    });
  });

  it("falls back to 502 when the in-band error names no status", async () => {
    const res = await handleStreamingResponse(
      params({ providerResponse: sseResponse([contentFrame("Our servers are currently overloaded. Please try again later.")]) }),
    );

    expect(res.success).toBe(false);
    expect(res.status).toBe(502);
  });

  it("leaves a genuine answer alone", async () => {
    const res = await handleStreamingResponse(
      params({ providerResponse: sseResponse([contentFrame("Here is the answer you asked for.")]) }),
    );

    expect(res.success).toBe(true);
    expect(saveRequestDetail.mock.calls[0][0].status).toBe("pending");
  });
});
