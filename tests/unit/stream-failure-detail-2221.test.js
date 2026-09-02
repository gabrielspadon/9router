// #2221 (second half) — "add a function that allows viewing specific logs when a
// click error occurs". The storage, not the presentation, was the gap: chatCore
// records a request detail for a transport throw and for a non-2xx upstream, but
// handleStreamingResponse rejects the 200-OK-but-unusable cases (HTML error page,
// empty body, empty stream, a JSON error payload) and returned before the
// placeholder row was ever written. Those requests left nothing to click.
import { beforeEach, describe, expect, it, vi } from "vitest";

const saveRequestDetail = vi.fn(() => Promise.resolve());

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestDetail,
  saveRequestUsage: vi.fn(() => Promise.resolve()),
  appendRequestLog: vi.fn(() => Promise.resolve()),
}));

const { handleStreamingResponse } = await import("open-sse/handlers/chatCore/streamingHandler.js");

function sseResponse(chunks, contentType = "text/event-stream") {
  const headers = new Map([["content-type", contentType]]);
  headers.get = (k) => (k.toLowerCase() === "content-type" ? contentType : null);
  const text = chunks.join("");
  return {
    status: 200,
    headers,
    text: async () => text,
    body: new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    }),
  };
}

const baseParams = {
  provider: "nvidia",
  model: "meta/llama-3.1-70b-instruct",
  sourceFormat: "openai",
  targetFormat: "openai",
  userAgent: "test-agent",
  body: { stream: true, model: "meta/llama-3.1-70b-instruct", messages: [{ role: "user", content: "hi" }] },
  translatedBody: { model: "upstream-id" },
  finalBody: { model: "upstream-id", messages: [{ role: "user", content: "hi" }] },
  requestStartTime: Date.now(),
  connectionId: "conn-2221",
  apiKey: "k",
  clientRawRequest: null,
  reqLogger: { logTargetRequest: () => {}, logError: () => {} },
  toolNameMap: null,
  customToolNames: null,
  streamController: {
    signal: new AbortController().signal,
    isConnected: () => true,
    handleComplete: vi.fn(),
    handleError: vi.fn(),
    handleDisconnect: vi.fn(),
    abort: vi.fn(),
  },
  onStreamComplete: vi.fn(),
  streamDetailId: "detail-2221",
  pxpipe: null,
  reqTag: "REQ_2221",
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), errorLine: vi.fn(), line: vi.fn() },
};

function savedDetail() {
  expect(saveRequestDetail).toHaveBeenCalledTimes(1);
  return saveRequestDetail.mock.calls[0][0];
}

describe("#2221 a stream that fails before it starts is still recorded", () => {
  beforeEach(() => saveRequestDetail.mockClear());

  it("records the upstream HTML error page a non-SSE content type carries", async () => {
    const res = await handleStreamingResponse({
      ...baseParams,
      providerResponse: sseResponse(["<html><title>502 Bad Gateway</title></html>"], "text/html"),
    });

    expect(res.success).toBe(false);
    const detail = savedDetail();
    expect(detail.status).toBe("error");
    expect(detail.id).toBe("detail-2221");
    expect(detail.provider).toBe("nvidia");
    expect(detail.response.error).toMatch(/502 Bad Gateway/);
    expect(detail.response.status).toBe(res.status);
    // The upstream body that produced it is what makes the row worth opening.
    expect(detail.providerRequest).toEqual(baseParams.finalBody);
    expect(detail.request.model).toBe("meta/llama-3.1-70b-instruct");
  });

  it("records an empty 200 stream", async () => {
    const res = await handleStreamingResponse({ ...baseParams, providerResponse: sseResponse([]) });

    expect(res.success).toBe(false);
    expect(savedDetail()).toMatchObject({ status: "error", response: { status: 502 } });
    expect(savedDetail().response.error).toMatch(/empty stream/i);
  });

  it("records a JSON error payload served as 200 OK, with the upstream's own status", async () => {
    const res = await handleStreamingResponse({
      ...baseParams,
      providerResponse: sseResponse([JSON.stringify({ error: { message: "Model overloaded", status: 503 } })]),
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe(503);
    expect(savedDetail()).toMatchObject({
      status: "error",
      response: { error: "Model overloaded", status: 503 },
    });
  });

  it("records a missing response body", async () => {
    const headers = new Map();
    headers.get = () => "text/event-stream";
    const res = await handleStreamingResponse({
      ...baseParams,
      providerResponse: { status: 200, headers, body: null },
    });

    expect(res.success).toBe(false);
    expect(savedDetail().response.error).toMatch(/no response body/i);
  });

  it("leaves the returned error envelope byte-identical to what callers already expect", async () => {
    const res = await handleStreamingResponse({ ...baseParams, providerResponse: sseResponse([]) });
    expect(res.response.status).toBe(502);
    expect(res.response.headers.get("Content-Type")).toBe("application/json");
    await expect(res.response.json()).resolves.toEqual({
      error: { message: `[502]: ${res.error}` },
    });
  });
});
