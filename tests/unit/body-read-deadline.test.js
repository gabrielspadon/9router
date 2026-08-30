import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BodyReadTimeoutError,
  consumeResponseBodyWithDeadline,
  isBodyReadTimeoutError,
  readResponseJsonWithDeadline,
  readResponseTextWithDeadline,
} from "../../open-sse/utils/bodyTimeout.js";
import {
  CallerAbortError,
  isCallerAbortError,
} from "../../open-sse/utils/error.js";

function recordingStream(chunks = [], { stall = false } = {}) {
  const encoder = new TextEncoder();
  const events = { cancel: [], getReader: 0, releaseLock: 0 };
  let controller;
  const body = new ReadableStream({
    start(next) {
      controller = next;
      for (const chunk of chunks) next.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      if (!stall) next.close();
    },
    cancel(reason) {
      events.cancel.push(reason);
    },
  });
  const getReader = body.getReader.bind(body);
  body.getReader = () => {
    events.getReader += 1;
    const reader = getReader();
    const releaseLock = reader.releaseLock.bind(reader);
    reader.releaseLock = () => {
      events.releaseLock += 1;
      return releaseLock();
    };
    return reader;
  };
  return { body, controller, events };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("reader-owned response body deadline", () => {
  it("decodes split UTF-8 through its acquired reader and releases it once", async () => {
    const text = "before € after";
    const bytes = new TextEncoder().encode(text);
    const split = bytes.indexOf(0xe2) + 1;
    const { body, events } = recordingStream([bytes.slice(0, split), bytes.slice(split)]);

    await expect(readResponseTextWithDeadline({ body, timeoutMs: 1000 })).resolves.toBe(text);
    expect(events).toEqual({ cancel: [], getReader: 1, releaseLock: 1 });
  });

  it("parses JSON only after its reader has fully decoded the body", async () => {
    const { body, events } = recordingStream(['{"answer":"ok"}']);

    await expect(readResponseJsonWithDeadline({ body, timeoutMs: 1000 })).resolves.toEqual({ answer: "ok" });
    expect(events).toEqual({ cancel: [], getReader: 1, releaseLock: 1 });
  });

  it("cancels the owned reader with a typed body deadline and never resolves late EOF", async () => {
    vi.useFakeTimers();
    const { body, controller, events } = recordingStream([], { stall: true });
    const pending = readResponseTextWithDeadline({ body, timeoutMs: 1000 });
    const rejected = expect(pending).rejects.toSatisfy((error) => {
      expect(error).toBeInstanceOf(BodyReadTimeoutError);
      expect(isBodyReadTimeoutError(error)).toBe(true);
      expect(error).toMatchObject({
        name: "BodyReadTimeoutError",
        code: "UPSTREAM_RESPONSE_BODY_TIMEOUT",
        timeoutMs: 1000,
      });
      return true;
    });

    await vi.advanceTimersByTimeAsync(1000);
    try { controller.close(); } catch { /* reader cancellation closed it first */ }
    await rejected;
    expect(events.cancel).toHaveLength(1);
    expect(events.cancel[0]).toBeInstanceOf(BodyReadTimeoutError);
    expect(events.releaseLock).toBe(1);
  });

  it("preserves the caller abort reason as the first terminal cause", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const reason = new DOMException("client left", "AbortError");
    const { body, events } = recordingStream([], { stall: true });
    const pending = readResponseTextWithDeadline({
      body,
      callerSignal: caller.signal,
      timeoutMs: 1000,
    });
    const rejected = expect(pending).rejects.toSatisfy((error) => {
      expect(error).toBeInstanceOf(CallerAbortError);
      expect(isCallerAbortError(error)).toBe(true);
      expect(error.reason).toBe(reason);
      return true;
    });

    caller.abort(reason);
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    expect(events.cancel).toHaveLength(1);
    expect(events.cancel[0]).toBeInstanceOf(CallerAbortError);
    expect(events.releaseLock).toBe(1);
  });

  it("gives the consumer an owned reader instead of the raw stream", async () => {
    const { body, events } = recordingStream(["ok"]);
    const received = await consumeResponseBodyWithDeadline({
      body,
      timeoutMs: 1000,
      consume: async (reader) => {
        expect(reader).toHaveProperty("read");
        expect(reader).not.toBe(body);
        return (await reader.read()).value;
      },
    });

    expect(new TextDecoder().decode(received)).toBe("ok");
    expect(events).toEqual({ cancel: [], getReader: 1, releaseLock: 1 });
  });
});
