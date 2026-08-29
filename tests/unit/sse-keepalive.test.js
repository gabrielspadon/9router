import { describe, it, expect, afterEach } from "vitest";

import {
  pipeWithDisconnect,
  createStreamController,
} from "../../open-sse/utils/streamHandler.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PING = "event: ping";

function passthroughTransform() {
  return new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
    },
  });
}

function responseFrom(stream) {
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

// Spy passthrough: records every chunk entering the translator input.
function spyTransform(seen) {
  return new TransformStream({
    transform(chunk, controller) {
      seen.push(decoder.decode(chunk));
      controller.enqueue(chunk);
    },
  });
}

function trackingController() {
  const base = createStreamController({ provider: "test", model: "test" });
  return {
    controller: {
      signal: base.signal,
      startTime: base.startTime,
      isConnected: () => base.isConnected(),
      handleComplete: () => base.handleComplete(),
      handleError: () => {},
      handleDisconnect: () => base.handleDisconnect("test"),
      abort: () => base.abort(),
    },
  };
}

// Start draining the downstream reader, sampling `ms` worth of output.
async function drainFor(piped, ms) {
  const reader = piped.getReader();
  const seen = [];
  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        seen.push(decoder.decode(value));
      }
    } catch {
      /* terminal */
    }
  })();
  await new Promise((r) => setTimeout(r, ms));
  await reader.cancel().catch(() => {});
  return seen;
}

describe("SSE keepalive (post-transform, pre-first-chunk only)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits pings post-transform while chunkCount is 0, stops at first chunk; translator input never sees a ping", async () => {
    const translatorInput = [];
    const downstream = [];
    let upstream;
    const never = new ReadableStream({
      start(controller) {
        upstream = controller;
      },
    });
    const { controller } = trackingController();
    const piped = pipeWithDisconnect(
      responseFrom(never),
      spyTransform(translatorInput),
      controller,
      null,
      10_000, // stall far away
      10_000, // ttft far away
      40, // ping every 40ms
    );
    const reader = piped.getReader();
    (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          downstream.push(decoder.decode(value));
        }
      } catch {
        /* terminal */
      }
    })();

    await new Promise((r) => setTimeout(r, 200));
    expect(
      downstream.filter((c) => c.includes(PING)).length,
    ).toBeGreaterThanOrEqual(2);
    // Translator input stays clean: no ping frame ever reached it.
    expect(translatorInput.some((c) => c.includes(PING))).toBe(false);
    expect(translatorInput).toHaveLength(0);

    // First real chunk stops the pings.
    upstream.enqueue(encoder.encode("data: hello\n\n"));
    await new Promise((r) => setTimeout(r, 150));
    const helloIdx = downstream.findIndex((c) => c.includes("data: hello"));
    expect(helloIdx).toBeGreaterThan(-1);
    const lastPingIdx = downstream
      .map((c) => c.includes(PING))
      .lastIndexOf(true);
    expect(helloIdx).toBeGreaterThan(lastPingIdx);
    expect(
      downstream.slice(helloIdx).filter((c) => c.includes(PING)),
    ).toHaveLength(0);
    await reader.cancel().catch(() => {});
  });

  it("keepaliveMs = 0 disables pings entirely", async () => {
    const translatorInput = [];
    const never = new ReadableStream({ start() {} });
    const { controller } = trackingController();
    const piped = pipeWithDisconnect(
      responseFrom(never),
      spyTransform(translatorInput),
      controller,
      null,
      10_000,
      10_000,
      0,
    );
    const downstream = await drainFor(piped, 150);
    expect(downstream.some((c) => c.includes(PING))).toBe(false);
    expect(translatorInput).toHaveLength(0);
  });

  it("keepalive timer is cleared on every terminal path (complete / error / disconnect)", async () => {
    for (const [name, trigger] of Object.entries({
      complete: (upstream, reader) => upstream.close(),
      error: (upstream, reader) => upstream.error(new Error("boom")),
      disconnect: (upstream, reader) => reader.cancel("gone"),
    })) {
      let upstreamController;
      const never = new ReadableStream({
        start(controller) {
          upstreamController = controller;
        },
      });
      const { controller } = trackingController();
      const piped = pipeWithDisconnect(
        responseFrom(never),
        passthroughTransform(),
        controller,
        null,
        10_000,
        10_000,
        50,
      );
      const reader = piped.getReader();
      const seen = [];
      (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            seen.push(decoder.decode(value));
          }
        } catch {
          /* terminal */
        }
      })();
      await new Promise((r) => setTimeout(r, 120)); // a ping or two lands
      const pingsBefore = seen.filter((c) => c.includes(PING)).length;
      expect(pingsBefore).toBeGreaterThanOrEqual(1);
      trigger(upstreamController, reader);
      await new Promise((r) => setTimeout(r, 200)); // several ping intervals pass
      expect(seen.filter((c) => c.includes(PING)).length).toBe(pingsBefore);
      await reader.cancel().catch(() => {});
    }
  });

  it("TTFT fire clears the keepalive", async () => {
    const never = new ReadableStream({ start() {} });
    const { controller } = trackingController();
    const piped = pipeWithDisconnect(
      responseFrom(never),
      passthroughTransform(),
      controller,
      null,
      10_000,
      80, // TTFT fires at 80ms
      40, // ping every 40ms
    );
    const downstream = await drainFor(piped, 300);
    const pingIdx = downstream.map((c) => c.includes(PING));
    const lastPing = pingIdx.lastIndexOf(true);
    // Pings stop after the TTFT window; none arrive in the tail.
    expect(lastPing).toBeGreaterThan(-1);
    expect(pingIdx.slice(lastPing + 1).some(Boolean)).toBe(false);
    expect(downstream.length - lastPing - 1).toBeLessThanOrEqual(1);
  });
});
