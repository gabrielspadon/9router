import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { resolveKiroModels, clearKiroModelCache } from "../../open-sse/services/kiroModels.js";

// #1357: ListAvailableModels ran under a 30s AbortController, but the timer was
// cleared in a `finally` that closed the moment `fetch()` resolved. fetch()
// resolves on RESPONSE HEADERS, so `response.json()` / `response.text()` then ran
// with no deadline at all: an endpoint that answered headers and stalled its body
// hung the call forever. /v1/models awaits one live resolver per connection in
// sequence, so a single stalled account starved every other account's catalog --
// "some models load, others fail with timeout" across several connections.
const CREDS = () => ({
  accessToken: `tok-${Math.random()}`,
  refreshToken: "refresh",
  providerSpecificData: { profileArn: "arn:aws:codewhisperer:us-east-1:1:profile/A" },
});

/** A response whose body never settles until its request signal aborts. */
function stallingBodyResponse(signalRef) {
  const neverUntilAbort = () =>
    new Promise((_resolve, reject) => {
      const signal = signalRef.current;
      if (signal?.aborted) return reject(new Error("aborted"));
      signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  return { ok: true, status: 200, statusText: "OK", json: neverUntilAbort, text: neverUntilAbort };
}

describe("Kiro catalog fetch body deadline (#1357)", () => {
  let originalFetch;

  beforeEach(() => {
    clearKiroModelCache();
    originalFetch = globalThis.fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it("aborts a body that stalls after the headers arrive", async () => {
    const signalRef = { current: null };
    globalThis.fetch = vi.fn(async (_url, opts) => {
      signalRef.current = opts.signal;
      return stallingBodyResponse(signalRef);
    });

    const pending = resolveKiroModels(CREDS(), {});
    let settled = false;
    pending.then(() => { settled = true; });

    // Header phase is over; without the fix the only timer is already cleared.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled, "still reading the stalled body").toBe(false);

    await vi.advanceTimersByTimeAsync(35_000);
    // Failure is swallowed into a null so callers fall back to the static
    // catalog -- the point is that it RESOLVES rather than hanging forever.
    await expect(pending).resolves.toBeNull();
    expect(signalRef.current.aborted, "the fetch signal fired").toBe(true);
  });

  it("aborts a stalled error body too, not just the success path", async () => {
    const signalRef = { current: null };
    globalThis.fetch = vi.fn(async (_url, opts) => {
      signalRef.current = opts.signal;
      return { ...stallingBodyResponse(signalRef), ok: false, status: 500 };
    });

    const pending = resolveKiroModels(CREDS(), {});
    await vi.advanceTimersByTimeAsync(35_000);
    await expect(pending).resolves.toBeNull();
    expect(signalRef.current.aborted).toBe(true);
  });

  it("clears the timer on the normal path, leaving no handle behind", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ models: [{ modelId: "claude-sonnet-4.5", modelName: "Claude Sonnet 4.5" }] }),
    }));

    const result = await resolveKiroModels(CREDS(), {});
    expect(result?.models?.some((m) => m.id === "claude-sonnet-4.5")).toBe(true);
    // A leaked 30s timer would keep the fake clock non-empty.
    expect(vi.getTimerCount()).toBe(0);
  });
});
