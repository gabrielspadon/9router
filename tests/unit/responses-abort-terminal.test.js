import { describe, expect, it } from "vitest";

import { createDisconnectAwareStream } from "../../open-sse/utils/streamHandler.js";
import { buildAbortedResponsesTerminalBytes } from "../../open-sse/utils/responsesStreamHelpers.js";

// Minimal stream controller stub
function makeController() {
  let connected = true;
  return {
    signal: new AbortController().signal,
    startTime: Date.now(),
    isConnected: () => connected,
    handleComplete: () => { connected = false; },
    handleError: () => { connected = false; },
    handleDisconnect: () => { connected = false; },
    abort: () => { connected = false; },
  };
}

// Reads to the end whether the stream closes or errors, and reports which.
// A stream that errors is not a test failure here: with no onAbortTerminal to
// synthesize, an upstream socket reset is surfaced to the client rather than
// closed over (#1513), so the bytes have to be collected either way.
async function readAll(stream) {
  const { text } = await readOutcome(stream);
  return text;
}

async function readOutcome(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    try {
      const { value, done } = await reader.read();
      if (done) return { ended: "closed", text: text + decoder.decode() };
      text += decoder.decode(value, { stream: true });
    } catch {
      return { ended: "errored", text: text + decoder.decode() };
    }
  }
}

describe("Responses abort terminal synthesis", () => {
  it("emits response.failed + [DONE] when upstream errors (abort/stall)", async () => {
    // Upstream readable that errors mid-stream (simulates fetch abort on stall)
    const upstream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("event: response.created\ndata: {}\n\n"));
        controller.error(new Error("stream stall timeout"));
      },
    });

    const out = createDisconnectAwareStream(
      { readable: upstream, writable: { getWriter: () => ({ abort: () => Promise.resolve() }) } },
      makeController(),
      buildAbortedResponsesTerminalBytes
    );

    const text = await readAll(out);
    expect(text).toContain("event: response.failed");
    expect(text).toContain("data: [DONE]");
  });

  it("does not synthesize terminal for non-Responses streams (callback null)", async () => {
    const upstream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: hi\n\n"));
        controller.error(new Error("socket hang up"));
      },
    });

    const out = createDisconnectAwareStream(
      { readable: upstream, writable: { getWriter: () => ({ abort: () => Promise.resolve() }) } },
      makeController(),
      null
    );

    const { ended, text } = await readOutcome(out);
    expect(text).not.toContain("response.failed");
    expect(text).not.toContain("[DONE]");
    // Nothing was synthesized, so the reset is reported as one instead of
    // reaching the client as a complete answer (#1513).
    expect(ended).toBe("errored");
  });
});
