import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalFetch = global.fetch;

describe("Kiro live model catalog region validation", () => {
  beforeEach(() => {
    vi.resetModules();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("rejects an unsafe profile ARN region before sending its Bearer token", async () => {
    const { clearKiroModelCache, resolveKiroModels } = await import("../../open-sse/services/kiroModels.js");
    clearKiroModelCache();

    await expect(resolveKiroModels({
      accessToken: "catalog-token",
      providerSpecificData: {
        profileArn: "arn:aws:codewhisperer:us-east-1.evil.example/#:123456789012:profile/ABC",
      },
    }, { forceRefresh: true })).resolves.toBeNull();

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("uses a validated profile ARN region for its Bearer-authenticated catalog URL", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] }),
    });
    const { clearKiroModelCache, resolveKiroModels } = await import("../../open-sse/services/kiroModels.js");
    clearKiroModelCache();

    await expect(resolveKiroModels({
      accessToken: "catalog-token",
      providerSpecificData: {
        profileArn: "arn:aws:codewhisperer:eu-central-1:123456789012:profile/ABC",
      },
    }, { forceRefresh: true })).resolves.toEqual({ models: [], rawModels: [] });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("https://q.eu-central-1.amazonaws.com/ListAvailableModels?"),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer catalog-token" }),
      })
    );
  });
});
