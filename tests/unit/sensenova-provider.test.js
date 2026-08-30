import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  getProviderConnectionByIdFromModels: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  testProxyUrl: vi.fn(),
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
  getProviderConnectionById: mocks.getProviderConnectionByIdFromModels,
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

vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "kimchi/test",
  updateKimchiUserAgent: vi.fn(),
}));

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";
import { FETCH_CONNECT_TIMEOUT_MS } from "../../open-sse/config/runtimeConfig.js";

const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");
const { GET: listProviderModels } = await import("../../src/app/api/providers/[id]/models/route.js");

const originalFetch = global.fetch;
const connection = {
  id: "sensenova-connection",
  provider: "sensenova",
  authType: "apikey",
  apiKey: "test-sensenova-key",
  providerSpecificData: {},
};

describe("SenseNova provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
    mocks.testProxyUrl.mockResolvedValue({ ok: true });
    mocks.updateProviderConnection.mockResolvedValue(undefined);
    mocks.getProviderConnectionById.mockResolvedValue(connection);
    mocks.getProviderConnectionByIdFromModels.mockResolvedValue(connection);
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("registers only the current official chat-capable catalog", () => {
    const provider = REGISTRY.find((entry) => entry.id === "sensenova");

    expect(provider).toMatchObject({
      alias: "sensenova",
      aliases: ["sn"],
      uiAlias: "sn",
      category: "freeTier",
      authType: "apikey",
      transport: {
        baseUrl: "https://token.sensenova.cn/v1/chat/completions",
        validateUrl: "https://token.sensenova.cn/v1/models",
      },
    });
    expect(PROVIDER_MODELS.sensenova.map(({ id }) => id)).toEqual([
      "sensenova-6.8-flash-lite",
      "deepseek-v4-flash",
      "glm-5.2",
    ]);
  });

  it("resolves sn without creating the misspelled sensnova alias", () => {
    expect(resolveProviderAlias("sn")).toBe("sensenova");
    expect(resolveProviderAlias("sensnova")).toBe("sensnova");
  });

  it("uses the default OpenAI transport with Bearer API-key authentication", () => {
    const executor = new DefaultExecutor("sensenova");

    expect(PROVIDERS.sensenova).toMatchObject({
      format: "openai",
      baseUrl: "https://token.sensenova.cn/v1/chat/completions",
      validateUrl: "https://token.sensenova.cn/v1/models",
    });
    expect(executor.buildUrl("glm-5.2", true)).toBe(
      "https://token.sensenova.cn/v1/chat/completions",
    );
    expect(executor.buildHeaders({ apiKey: "test-sensenova-key" }, true)).toMatchObject({
      Authorization: "Bearer test-sensenova-key",
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    });
  });

  it("lists models through the authenticated official endpoint", async () => {
    global.fetch.mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: "sensenova-6.8-flash-lite" },
        { id: "deepseek-v4-flash" },
        { id: "glm-5.2" },
      ],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const response = await listProviderModels(
      new Request("http://localhost/api/providers/sensenova-connection/models"),
      { params: Promise.resolve({ id: "sensenova-connection" }) },
    );

    expect(await response.json()).toMatchObject({
      provider: "sensenova",
      connectionId: "sensenova-connection",
      models: [
        { id: "sensenova-6.8-flash-lite" },
        { id: "deepseek-v4-flash" },
        { id: "glm-5.2" },
      ],
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://token.sensenova.cn/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer test-sensenova-key",
        }),
      }),
    );
  });

  it("tests saved keys with a bounded GET models probe", async () => {
    const probeSignal = new AbortController().signal;
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(probeSignal);
    global.fetch.mockResolvedValue(new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const result = await testSingleConnection("sensenova-connection");

    expect(result.valid).toBe(true);
    expect(timeoutSpy).toHaveBeenCalledWith(FETCH_CONNECT_TIMEOUT_MS);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://token.sensenova.cn/v1/models",
      {
        method: "GET",
        headers: { Authorization: "Bearer test-sensenova-key" },
        signal: probeSignal,
      },
    );
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "sensenova-connection",
      expect.objectContaining({ testStatus: "active", lastError: null }),
    );

    timeoutSpy.mockRestore();
  });
});
