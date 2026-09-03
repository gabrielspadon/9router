// G3 — continuous SSE liveness.
//
// RECONCILIATION.md P1 "Continuous SSE liveness" and overlay-spec.md §5.
// Downstream heartbeats must continue during EVERY silent interval, pre-TTFT
// and mid-stream alike. Three invariants, each with its own failure mode:
//
//   1. A heartbeat is TRANSPORT, not content. Feeding one back through the
//      translator hands a parser a frame no provider sent.
//   2. A heartbeat is not upstream progress. If a ping reset the upstream stall
//      clock, a hung provider would look alive forever and the watchdog that
//      exists to abort it would never fire — the failure direction §5 calls out
//      by name ("must never reset an independent upstream-stall clock").
//   3. A heartbeat cannot outlive the stream. Pings after a terminal event are
//      bytes written onto a finished response.
//
// Every timing here is on vitest's fake clock. A heartbeat test that sleeps on
// wall time is flaky by construction, and the invariants above are all about
// WHEN something fires relative to something else, so the clock is the
// instrument, not an inconvenience.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  pipeWithDisconnect,
  createStreamController,
} from "open-sse/utils/streamHandler.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PING = "event: ping";

const KEEPALIVE_MS = 100;
const STALL_MS = 1000;
const TTFT_MS = 100_000; // far enough away to never confound a case below

function responseFrom(stream) {
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

/** Records every chunk that reaches the TRANSLATOR input, then passes it on. */
function spyTransform(seen) {
  return new TransformStream({
    transform(chunk, controller) {
      seen.push(decoder.decode(chunk));
      controller.enqueue(chunk);
    },
  });
}

/**
 * A controller that records terminal calls instead of performing them, so a
 * case can assert WHICH terminal fired and when. `isConnected` stays true until
 * a terminal lands, matching createStreamController's own latch.
 */
function recordingController() {
  const base = createStreamController({ provider: "test", model: "test" });
  const events = [];
  let live = true;
  return {
    events,
    errors: () => events.filter((e) => e.type === "error").map((e) => e.message),
    controller: {
      signal: base.signal,
      startTime: base.startTime,
      isConnected: () => live,
      handleComplete: () => {
        live = false;
        events.push({ type: "complete" });
      },
      handleError: (e) => {
        live = false;
        events.push({ type: "error", message: e?.message || String(e) });
      },
      handleDisconnect: (reason) => {
        live = false;
        events.push({ type: "disconnect", reason: String(reason) });
      },
      abort: () => events.push({ type: "abort" }),
    },
  };
}

/**
 * Continuously drain the downstream stream into `frames`.
 *
 * Draining is not optional. The pipeline only pulls when there is demand, and
 * the keepalive skips a beat when its queue has backed up, so an undrained
 * stream would silently stop emitting and every case would "pass" for the wrong
 * reason.
 */
function drain(stream) {
  const frames = [];
  const reader = stream.getReader();
  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        frames.push(decoder.decode(value));
      }
    } catch {
      /* terminal — the case asserts on what arrived before it */
    }
  })();
  return { frames, cancel: () => reader.cancel().catch(() => {}) };
}

const pings = (frames) => frames.filter((f) => f.includes(PING)).length;

/** An upstream whose chunks this test emits by hand. */
function manualUpstream() {
  let ctl;
  const body = new ReadableStream({
    start(controller) {
      ctl = controller;
    },
  });
  return {
    body,
    push: (text) => ctl.enqueue(encoder.encode(text)),
    close: () => ctl.close(),
    error: (e) => ctl.error(e),
  };
}

function pipe({ upstream, translatorInput, controller, keepaliveMs = KEEPALIVE_MS, stallTimeoutMs = STALL_MS }) {
  return pipeWithDisconnect(
    responseFrom(upstream.body),
    spyTransform(translatorInput),
    controller,
    null,
    stallTimeoutMs,
    TTFT_MS,
    keepaliveMs,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("G3 — downstream heartbeats during every silent interval", () => {
  it("beats through PRE-TTFT silence, and through MID-STREAM silence after real data", async () => {
    const translatorInput = [];
    const upstream = manualUpstream();
    const { controller } = recordingController();
    const { frames, cancel } = drain(pipe({ upstream, translatorInput, controller }));

    // Pre-TTFT: nothing from the provider yet, but the client must see liveness.
    await vi.advanceTimersByTimeAsync(KEEPALIVE_MS * 5);
    const prePings = pings(frames);
    expect(prePings).toBeGreaterThanOrEqual(4);

    // First real chunk arrives. This is the exact point the pre-correction
    // implementation gave up on heartbeats for the rest of the stream.
    upstream.push("data: first\n\n");
    await vi.advanceTimersByTimeAsync(0);
    expect(frames.some((f) => f.includes("data: first"))).toBe(true);
    const atFirstData = pings(frames);

    // Mid-stream silence: the provider is thinking. Heartbeats must resume.
    await vi.advanceTimersByTimeAsync(KEEPALIVE_MS * 5);
    expect(pings(frames) - atFirstData).toBeGreaterThanOrEqual(4);

    // And again after a second chunk, so this is a repeating property rather
    // than one post-data burst.
    upstream.push("data: second\n\n");
    await vi.advanceTimersByTimeAsync(0);
    const atSecondData = pings(frames);
    await vi.advanceTimersByTimeAsync(KEEPALIVE_MS * 5);
    expect(pings(frames) - atSecondData).toBeGreaterThanOrEqual(4);

    cancel();
  });

  it("a real downstream byte DEFERS the next beat by a full interval", async () => {
    // Re-arming on write is what keeps a ping from interleaving with data. The
    // observable form: immediately after a chunk, less than one interval of
    // silence produces no ping at all.
    const translatorInput = [];
    const upstream = manualUpstream();
    const { controller } = recordingController();
    const { frames, cancel } = drain(pipe({ upstream, translatorInput, controller }));

    await vi.advanceTimersByTimeAsync(KEEPALIVE_MS * 3);
    upstream.push("data: chunk\n\n");
    await vi.advanceTimersByTimeAsync(0);
    const afterChunk = pings(frames);

    // Just under one interval of silence: the window restarted, so nothing fires.
    await vi.advanceTimersByTimeAsync(KEEPALIVE_MS - 1);
    expect(pings(frames)).toBe(afterChunk);

    // Crossing the interval produces exactly the next beat.
    await vi.advanceTimersByTimeAsync(1);
    expect(pings(frames)).toBe(afterChunk + 1);

    cancel();
  });

  it("NEVER enters the translator — pre-TTFT and mid-stream", async () => {
    const translatorInput = [];
    const upstream = manualUpstream();
    const { controller } = recordingController();
    const { frames, cancel } = drain(pipe({ upstream, translatorInput, controller }));

    // Pre-TTFT: pings are reaching the client while the translator saw nothing.
    await vi.advanceTimersByTimeAsync(KEEPALIVE_MS * 5);
    expect(pings(frames)).toBeGreaterThanOrEqual(4);
    expect(translatorInput).toHaveLength(0);

    // Mid-stream: the translator sees the data chunk and ONLY the data chunk.
    upstream.push("data: real\n\n");
    await vi.advanceTimersByTimeAsync(KEEPALIVE_MS * 5);
    expect(pings(frames)).toBeGreaterThanOrEqual(8);
    expect(translatorInput).toEqual(["data: real\n\n"]);
    expect(translatorInput.some((c) => c.includes(PING))).toBe(false);

    cancel();
  });

  it("NEVER resets the upstream stall clock — a hung provider still trips it on time", async () => {
    // The invariant that matters most. Heartbeats fire ten times per stall
    // window here, so an implementation that re-armed the stall timer on a ping
    // would push the deadline out forever and this case would hang instead of
    // asserting.
    const translatorInput = [];
    const upstream = manualUpstream();
    const rec = recordingController();
    const { frames, cancel } = drain(pipe({ upstream, translatorInput, controller: rec.controller }));

    // One real chunk arms the stall clock at a known instant, then the provider
    // hangs. Everything after this point is heartbeat-only.
    upstream.push("data: last-real-byte\n\n");
    await vi.advanceTimersByTimeAsync(0);

    // One tick short of the stall window: many pings, no stall yet.
    await vi.advanceTimersByTimeAsync(STALL_MS - 1);
    expect(pings(frames)).toBeGreaterThanOrEqual(9);
    expect(rec.errors()).toEqual([]);

    // The stall fires exactly on schedule, unmoved by the heartbeats.
    await vi.advanceTimersByTimeAsync(1);
    expect(rec.errors()).toContain("stream stall timeout");

    cancel();
  });

  it("stops when the stream ENDS — upstream close", async () => {
    const translatorInput = [];
    const upstream = manualUpstream();
    const { controller } = recordingController();
    const { frames, cancel } = drain(pipe({ upstream, translatorInput, controller }));

    await vi.advanceTimersByTimeAsync(KEEPALIVE_MS * 3);
    expect(pings(frames)).toBeGreaterThanOrEqual(2);

    upstream.close();
    await vi.advanceTimersByTimeAsync(KEEPALIVE_MS);
    const atClose = pings(frames);

    // Many intervals later, not one more beat.
    await vi.advanceTimersByTimeAsync(KEEPALIVE_MS * 20);
    expect(pings(frames)).toBe(atClose);

    cancel();
  });

  it("stops when the stream ENDS — upstream error and downstream cancel", async () => {
    for (const [name, end] of Object.entries({
      error: (upstream) => upstream.error(new Error("boom")),
      cancel: (upstream, cancelFn) => cancelFn(),
    })) {
      const translatorInput = [];
      const upstream = manualUpstream();
      const { controller } = recordingController();
      const { frames, cancel } = drain(pipe({ upstream, translatorInput, controller }));

      await vi.advanceTimersByTimeAsync(KEEPALIVE_MS * 3);
      expect(pings(frames), name).toBeGreaterThanOrEqual(2);

      end(upstream, cancel);
      await vi.advanceTimersByTimeAsync(KEEPALIVE_MS);
      const atEnd = pings(frames);

      await vi.advanceTimersByTimeAsync(KEEPALIVE_MS * 20);
      expect(pings(frames), name).toBe(atEnd);

      cancel();
    }
  });

  it("keepaliveMs = 0 disables heartbeats entirely (spec §5: 0 disables)", async () => {
    const translatorInput = [];
    const upstream = manualUpstream();
    const { controller } = recordingController();
    const { frames, cancel } = drain(
      pipe({ upstream, translatorInput, controller, keepaliveMs: 0 }),
    );

    await vi.advanceTimersByTimeAsync(KEEPALIVE_MS * 20);
    expect(pings(frames)).toBe(0);

    // Data still flows: disabling the ping disables nothing else.
    upstream.push("data: still-works\n\n");
    await vi.advanceTimersByTimeAsync(0);
    expect(frames.some((f) => f.includes("data: still-works"))).toBe(true);

    cancel();
  });
});
