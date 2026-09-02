import { afterEach, describe, expect, it, vi } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";

const PROVIDERS_UNDER_TEST = ["sumopod", "x5lab"].map((id) => ({
  id,
  modelsUrl: PROVIDERS[id]?.validateUrl,
}));

const SAVED_PROXY = {
  kind: "usable",
  resolutionKind: "selected-proxy",
  connectionProxyEnabled: true,
  connectionProxyUrl: "http://proxy.test:8080",
  connectionNoProxy: "localhost",
  vercelRelayUrl: "",
  strictProxy: true,
};

const EFFECTIVE_PROXY = {
  connectionProxyEnabled: true,
  connectionProxyUrl: "http://proxy.test:8080",
  connectionNoProxy: "localhost",
  vercelRelayUrl: "",
  strictProxy: true,
  resolutionKind: "selected-proxy",
};

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  toConnectionProxyOptions: vi.fn(),
  testProxyUrl: vi.fn(),
  proxyAwareFetch: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  toConnectionProxyOptions: mocks.toConnectionProxyOptions,
}));

vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl: mocks.testProxyUrl,
}));

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");

afterEach(() => {
  vi.clearAllMocks();
});

describe("SumoPod and X5Lab saved connection tests", () => {
  it.each(PROVIDERS_UNDER_TEST)("uses the saved proxy for $id /models validation", async ({ id, modelsUrl }) => {
    expect(REGISTRY.find((provider) => provider.id === id)?.transport?.validateUrl).toBe(modelsUrl);
    mocks.getProviderConnectionById.mockResolvedValue({
      id: `${id}-connection`,
      provider: id,
      authType: "apikey",
      apiKey: `${id}-test-key`,
      providerSpecificData: {},
    });
    mocks.resolveConnectionProxyConfig.mockResolvedValue(SAVED_PROXY);
    mocks.toConnectionProxyOptions.mockReturnValue(EFFECTIVE_PROXY);
    mocks.testProxyUrl.mockResolvedValue({ ok: true });
    mocks.proxyAwareFetch.mockResolvedValue(new Response("{}", { status: 200 }));
    mocks.updateProviderConnection.mockResolvedValue(undefined);

    const result = await testSingleConnection(`${id}-connection`);

    expect(result).toMatchObject({ valid: true, error: null });
    expect(mocks.proxyAwareFetch).toHaveBeenCalledWith(
      modelsUrl,
      expect.objectContaining({
        headers: { Authorization: `Bearer ${id}-test-key` },
        signal: expect.any(AbortSignal),
      }),
      EFFECTIVE_PROXY,
    );
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      `${id}-connection`,
      expect.objectContaining({ testStatus: "active", lastError: null }),
    );
  });

  it.each(PROVIDERS_UNDER_TEST)("keeps $id proxy failures bounded", async ({ id }) => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: `${id}-connection`,
      provider: id,
      authType: "apikey",
      apiKey: `${id}-test-key`,
      providerSpecificData: {},
    });
    mocks.resolveConnectionProxyConfig.mockResolvedValue(SAVED_PROXY);
    mocks.toConnectionProxyOptions.mockReturnValue(EFFECTIVE_PROXY);
    mocks.testProxyUrl.mockResolvedValue({ ok: true });
    mocks.proxyAwareFetch.mockRejectedValue(new Error("raw upstream credential diagnostic"));
    mocks.updateProviderConnection.mockResolvedValue(undefined);

    const result = await testSingleConnection(`${id}-connection`);

    expect(result).toMatchObject({ valid: false, error: "Unable to verify API key" });
    expect(JSON.stringify(result)).not.toContain("raw upstream credential diagnostic");
  });
});
