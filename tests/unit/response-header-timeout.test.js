import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConnectTimeoutError,
  createExecutorResponseHeaderTimeout,
  createResponseHeaderTimeout,
  isConnectTimeoutError,
} from "../../open-sse/utils/responseHeaderTimeout.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("response header timeout", () => {
  it("aborts with a typed error and clears idempotently", async () => {
    vi.useFakeTimers();
    const deadline = createResponseHeaderTimeout({ timeoutMs: 1000 });
    const aborted = new Promise((resolve) => deadline.signal.addEventListener("abort", resolve, { once: true }));
    await vi.advanceTimersByTimeAsync(1000);
    await aborted;
    const classified = deadline.classify(deadline.signal.reason);
    expect(classified).toBeInstanceOf(ConnectTimeoutError);
    expect(classified.timeoutMs).toBe(1000);
    expect(isConnectTimeoutError(classified)).toBe(true);
    deadline.clear();
    deadline.clear();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("forwards an already-aborted caller without timeout reclassification", () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const reason = new DOMException("client left", "AbortError");
    caller.abort(reason);
    const deadline = createResponseHeaderTimeout({ timeoutMs: 1000, signal: caller.signal });
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.classify(deadline.signal.reason)).toBe(reason);
    deadline.clear();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("forwards a later caller abort and removes its timer", () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const deadline = createResponseHeaderTimeout({ timeoutMs: 1000, signal: caller.signal });
    const reason = new DOMException("client left", "AbortError");
    caller.abort(reason);
    expect(deadline.signal.reason).toBe(reason);
    expect(deadline.classify(deadline.signal.reason)).toBe(reason);
    deadline.clear();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restores the caller reason when transport wraps the abort", () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const deadline = createResponseHeaderTimeout({ timeoutMs: 1000, signal: caller.signal });
    const reason = new DOMException("client left", "AbortError");
    caller.abort(reason);

    expect(deadline.classify(new Error("strict proxy wrapped abort"))).toBe(reason);
    deadline.clear();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps caller cancellation connected after response headers clear the timer", () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const deadline = createResponseHeaderTimeout({ timeoutMs: 1000, signal: caller.signal });
    deadline.clear();
    const reason = new DOMException("client left during body", "AbortError");
    caller.abort(reason);
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.signal.reason).toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([NaN, Infinity, 999, 120001, 15000.5, "15000"])("rejects invalid timeout %s", (timeoutMs) => {
    expect(() => createResponseHeaderTimeout({ timeoutMs })).toThrow(TypeError);
  });

  it("resolves executor precedence before creating the timer", () => {
    vi.useFakeTimers();
    const deadline = createExecutorResponseHeaderTimeout({
      connectTimeout: { providerOverride: undefined, globalTimeout: 15000 },
      registryTimeout: 120000,
      envTimeout: 60000,
    });
    expect(deadline.timeoutMs).toBe(120000);
    deadline.clear();
    expect(vi.getTimerCount()).toBe(0);
  });
});
