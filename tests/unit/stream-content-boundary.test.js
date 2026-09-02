import { describe, expect, it, vi } from "vitest";

import { handleStreamingResponse } from "open-sse/handlers/chatCore/streamingHandler.js";
import { peekStreamForContent } from "open-sse/utils/streamContent.js";

const encoder = new TextEncoder();

function createParams(providerResponse, onRequestSuccess) {
  return {
    providerResponse,
    provider: "nvidia",
    model: "meta/llama-3.1-70b-instruct",
    sourceFormat: "openai",
    targetFormat: "openai",
    userAgent: "test-agent",
    body: { stream: true },
    translatedBody: {},
    finalBody: {},
    requestStartTime: Date.now(),
    connectionId: "conn-stream-boundary",
    apiKey: "test-key",
    clientRawRequest: null,
    onRequestSuccess,
    reqLogger: { logTargetRequest() {}, logError() {} },
    toolNameMap: null,
    customToolNames: null,
    streamController: {
      signal: new AbortController().signal,
      isConnected: () => true,
      handleComplete() {},
      handleError() {},
      handleDisconnect() {},
      abort() {},
    },
    onStreamComplete() {},
    streamDetailId: "detail-stream-boundary",
    pxpipe: null,
    reqTag: "REQ_STREAM_BOUNDARY",
    log: { debug() {}, info() {}, warn() {}, errorLine() {}, line() {} },
  };
}

function sseResponse(frames) {
  const response = {
    status: 200,
    headers: new Map([["content-type", "text/event-stream"]]),
    body: new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    }),
  };
  response.headers.get = key => key.toLowerCase() === "content-type" ? "text/event-stream" : null;
  return response;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function bounded(promise, timeoutMs) {
  return Promise.race([
    promise,
    wait(timeoutMs).then(() => {
      throw new Error(`operation exceeded ${timeoutMs}ms`);
    }),
  ]);
}

async function readAll(body) {
  const reader = body.getReader();
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return new TextDecoder().decode(Buffer.concat(chunks));
      chunks.push(value);
    }
  } finally {
    try { await reader.cancel(); } catch {}
  }
}

function timedContentResponse(delayMs) {
  let cancelled = false;
  let timer;
  const response = sseResponse([]);
  response.body = new ReadableStream({
    start(controller) {
      timer = setTimeout(() => {
        if (cancelled) return;
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"late"}}]}\n\n'));
        controller.close();
      }, delayMs);
    },
    cancel() {
      cancelled = true;
      clearTimeout(timer);
    },
  });
  return { response, wasCancelled: () => cancelled };
}

function endlessKeepaliveResponse() {
  let cancelled = false;
  let interval;
  const response = sseResponse([]);
  response.body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(": keepalive\n\n"));
      interval = setInterval(() => {
        if (!cancelled) controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 1);
    },
    cancel() {
      cancelled = true;
      clearInterval(interval);
    },
  });
  return { response, wasCancelled: () => cancelled };
}

describe("non-combo streaming content boundary (#3463)", () => {
  it("rejects a role-only SSE stream before marking the request healthy", async () => {
    const onRequestSuccess = vi.fn();
    const providerResponse = sseResponse([
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ]);

    const result = await handleStreamingResponse(createParams(providerResponse, onRequestSuccess));

    expect(result).toMatchObject({ success: false, status: 502 });
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("cancels a timed-out first read before replaying a delayed content frame", async () => {
    const { response, wasCancelled } = timedContentResponse(30);

    const result = await peekStreamForContent(response, 5, { preserveOnNoContent: true });

    expect(result.hasContent).toBe(false);
    expect(wasCancelled()).toBe(true);
    await expect(bounded(readAll(result.body), 15)).resolves.toBe("");
  });

  it("replays only buffered keepalives and closes a timed-out endless stream", async () => {
    const { response, wasCancelled } = endlessKeepaliveResponse();

    const result = await peekStreamForContent(response, 5, { preserveOnNoContent: true });

    expect(result.hasContent).toBe(false);
    expect(wasCancelled()).toBe(true);
    await expect(bounded(readAll(result.body), 25)).resolves.toMatch(/^(?:\: keepalive\n\n)+$/);
  });
});
