import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const CREDITS_URL = "https://opengateway.gitlawb.com/v1/credits";
const MODELS_URL = "https://opengateway.gitlawb.com/v1/models";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  testProxyUrl: vi.fn(),
  proxyAwareFetch: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

vi.mock("@/models", () => ({
  getProviderNodeById: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));

vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl: mocks.testProxyUrl,
}));

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

const originalFetch = global.fetch;
const { POST: validateProvider } = await import("../../src/app/api/providers/validate/route.js");
const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");

const validationRequest = () => new Request("http://localhost/api/providers/validate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ provider: "gitlawb-opengateway", apiKey: "ogw_live_bogus" }),
});

describe("Gitlawb OpenGateway API-key validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
    mocks.testProxyUrl.mockResolvedValue({ ok: true });
    mocks.updateProviderConnection.mockResolvedValue(undefined);
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "opengateway-connection",
      provider: "gitlawb-opengateway",
      authType: "apikey",
      apiKey: "ogw_live_bogus",
      providerSpecificData: {},
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("does not accept a public models 200 as proof that a new key works", async () => {
    global.fetch.mockImplementation((url) => {
      if (url === MODELS_URL) return Promise.resolve(new Response("{}", { status: 200 }));
      return Promise.resolve(new Response("invalid key", { status: 401 }));
    });

    const response = await validateProvider(validationRequest());

    expect(await response.json()).toEqual({ valid: false, error: "Invalid API key" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      CREDITS_URL,
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer ogw_live_bogus" },
      }),
    );
  });

  it("uses the authenticated, non-billable credits probe through a saved proxy", async () => {
    mocks.proxyAwareFetch.mockResolvedValue(new Response("{}", { status: 200 }));

    const result = await testSingleConnection("opengateway-connection");

    expect(result).toMatchObject({ valid: true, error: null });
    expect(mocks.proxyAwareFetch).toHaveBeenCalledWith(
      CREDITS_URL,
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer ogw_live_bogus" },
        signal: expect.any(AbortSignal),
      }),
      {},
    );
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "opengateway-connection",
      expect.objectContaining({ testStatus: "active", lastError: null }),
    );
  });

  it("returns bounded diagnostics for an unavailable saved probe", async () => {
    mocks.proxyAwareFetch.mockRejectedValue(new Error("upstream credential diagnostic"));

    const result = await testSingleConnection("opengateway-connection");

    expect(result).toMatchObject({ valid: false, error: "Unable to verify API key" });
    expect(JSON.stringify(result)).not.toContain("upstream credential diagnostic");
  });
});
