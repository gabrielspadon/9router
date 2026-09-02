import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "../../src/app/api/providers/suggested-models/route.js";

const originalFetch = globalThis.fetch;

function requestFor(type, url) {
  return new Request(`http://router.test/api/providers/suggested-models?${new URLSearchParams({ type, url })}`);
}

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("suggested-models SSRF boundary", () => {
  it.each([
    ["openrouter-free", "http://169.254.169.254/latest/meta-data/"],
    ["openrouter-free", "https://openrouter.ai@127.0.0.1/private"],
    ["openrouter-free", "https://opencode.ai/zen/v1/models"],
  ])("rejects untrusted %s source %s before fetch", async (type, url) => {
    const response = await GET(requestFor(type, url));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "URL not allowed" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects an unknown filter before fetch", async () => {
    const response = await GET(requestFor("unknown", "https://openrouter.ai/api/v1/models"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Unknown filter type" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("uses the canonical registry source for a valid type", async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "free-model", name: "Free", pricing: { prompt: "0", completion: "0" }, context_length: 200000 }] }),
    });

    const response = await GET(requestFor("openrouter-free", "https://openrouter.ai/api/v1/models"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [{ id: "free-model", name: "Free", contextLength: 200000 }],
    });
    expect(globalThis.fetch).toHaveBeenCalledWith("https://openrouter.ai/api/v1/models", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
});
