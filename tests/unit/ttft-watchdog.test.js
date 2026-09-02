import { describe, it, expect, vi } from "vitest";

import { pipeWithDisconnect, createStreamController } from "../../open-sse/utils/streamHandler.js";

const encoder = new TextEncoder();

// Minimal passthrough transform: pipeWithDisconnect measures raw upstream bytes,
// so the SSE framing itself does not matter here.
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

// Collect what the wrapped controller saw and resolve when a terminal event lands.
function trackingController() {
  const events = [];
  let notifyTerminal;
  const terminalSeen = new Promise((resolve) => {
    notifyTerminal = resolve;
  });
  const base = createStreamController({ provider: "test", model: "test" });
  return {
    events,
    terminalSeen,
    controller: {
      signal: base.signal,
      startTime: base.startTime,
      isConnected: () => base.isConnected(),
      handleComplete: () => {
        base.handleComplete();
        events.push("complete");
        notifyTerminal("complete");
      },
      handleError: (e) => {
        base.handleError(e);
        events.push(["error", e]);
        notifyTerminal(["error", e]);
      },
      handleDisconnect: (r) => {
        base.handleDisconnect(r);
        events.push(["disconnect", r]);
        notifyTerminal(["disconnect", r]);
      },
      abort: () => base.abort(),
    },
  };
}

describe("pipeWithDisconnect TTFT watchdog", () => {
  it("aborts with a ttft-timeout error when the upstream emits nothing within the window", async () => {
    const never = new ReadableStream({
      start(controller) {
        this._controller = controller;
      }, // hold open, emit nothing
      cancel() {
        /* closed by abort */
      },
    });

    const { controller, events, terminalSeen } = trackingController();
    const started = Date.now();
    const piped = pipeWithDisconnect(
      responseFrom(never),
      passthroughTransform(),
      controller,
      null,
      10_000, // stall watchdog far away; only TTFT should fire
      60, // short TTFT window under test
    );

    // Drain downstream until the terminal event arrives.
    const reader = piped.getReader();
    const terminal = await terminalSeen;
    const elapsed = Date.now() - started;

    expect(terminal[0]).toBe("error");
    expect(terminal[1].message).toMatch(/ttft timeout/i);
    expect(elapsed).toBeLessThan(2000); // fired on the 60ms window, not the 10s stall
    expect(controller.signal.aborted).toBe(true);
    await reader.cancel().catch(() => {});
    void events;
  });

  it("does not fire when the first byte arrives just inside the window", async () => {
    // Emit one byte at 30ms against a 100ms TTFT window: the guard must disarm
    // on that byte and never abort, even if nothing further arrives.
    const late = new ReadableStream({
      start(controller) {
        setTimeout(() => {
          try {
            controller.enqueue(encoder.encode("data: ping\n\n"));
          } catch {
            /* closed */
          }
        }, 30);
        // Keep the stream open afterwards; a false TTFT abort would surface here.
      },
    });

    const { controller, terminalSeen } = trackingController();
    const piped = pipeWithDisconnect(
      responseFrom(late),
      passthroughTransform(),
      controller,
      null,
      10_000,
      100,
    );
    const reader = piped.getReader();

    const result = await Promise.race([
      terminalSeen.then((t) => ({ fired: true, t })),
      new Promise((r) => setTimeout(() => r({ fired: false }), 500)),
    ]);

    expect(result.fired).toBe(false); // no TTFT abort after the first byte
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("ping");
    await reader.cancel().catch(() => {});
  });
});
