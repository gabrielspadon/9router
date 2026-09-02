import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const WHOAMI_URL = "https://huggingface.co/api/whoami-v2";

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

const request = () => new Request("http://localhost/api/providers/validate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ provider: "huggingface", apiKey: "hf_test_token" }),
});

describe("HuggingFace API-key validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
    mocks.testProxyUrl.mockResolvedValue({ ok: true });
    mocks.updateProviderConnection.mockResolvedValue(undefined);
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "hf-connection",
      provider: "huggingface",
      authType: "apikey",
      apiKey: "hf_test_token",
      providerSpecificData: {},
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("validates a new key with HuggingFace whoami", async () => {
    global.fetch.mockResolvedValue(new Response("{}", { status: 200 }));

    const response = await validateProvider(request());

    expect(await response.json()).toEqual({ valid: true, error: null });
    expect(global.fetch).toHaveBeenCalledWith(
      WHOAMI_URL,
      expect.objectContaining({
        headers: { Authorization: "Bearer hf_test_token" },
      }),
    );
  });

  it("uses the same auth-only probe through a saved connection proxy", async () => {
    mocks.proxyAwareFetch.mockResolvedValue(new Response("{}", { status: 200 }));

    const result = await testSingleConnection("hf-connection");

    expect(result).toMatchObject({ valid: true, error: null });
    expect(mocks.proxyAwareFetch).toHaveBeenCalledWith(
      WHOAMI_URL,
      expect.objectContaining({
        headers: { Authorization: "Bearer hf_test_token" },
      }),
      {},
    );
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "hf-connection",
      expect.objectContaining({ testStatus: "active", lastError: null }),
    );
  });

  it("does not expose an upstream response as an invalid-key diagnostic", async () => {
    global.fetch.mockResolvedValue(new Response("upstream diagnostic", { status: 503 }));

    const response = await validateProvider(request());
    const payload = await response.json();

    expect(payload).toEqual({ valid: false, error: "Unable to verify API key" });
    expect(JSON.stringify(payload)).not.toContain("upstream diagnostic");
  });

  it("does not expose a saved connection proxy failure", async () => {
    mocks.proxyAwareFetch.mockRejectedValue(new Error("proxy upstream diagnostic"));

    const result = await testSingleConnection("hf-connection");

    expect(result).toMatchObject({ valid: false, error: "Unable to verify API key" });
    expect(JSON.stringify(result)).not.toContain("proxy upstream diagnostic");
  });
});
