import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  connectionsMock,
  customModelsMock,
  proxyAwareFetchMock,
  resolveProxyMock,
} = vi.hoisted(() => ({
  connectionsMock: vi.fn(),
  customModelsMock: vi.fn(),
  proxyAwareFetchMock: vi.fn(),
  resolveProxyMock: vi.fn(),
}));

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: proxyAwareFetchMock,
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: connectionsMock,
  getCombos: vi.fn(async () => []),
  getCustomModels: customModelsMock,
  getModelAliases: vi.fn(async () => ({})),
  getFreeModels: vi.fn(async () => ({})),
  getSettings: vi.fn(async () => ({})),
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => ({})),
}));

vi.mock("@/sse/services/tokenRefresh", () => ({
  updateProviderCredentials: vi.fn(async () => {}),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: resolveProxyMock,
}));

const {
  CLINE_RECOMMENDED_MODELS_ENDPOINT,
  normalizeClineModels,
  resolveClineModels,
} = await import("../../open-sse/services/clineModels.js");
const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

const OFFICIAL_PAYLOAD = {
  recommended: [
    { id: "moonshotai/kimi-k3", name: "kimi-k3" },
    { id: "anthropic/claude-opus-5", name: "claude-opus-5" },
    { id: "x-ai/grok-4.5", name: "grok-4.5" },
    { id: "openai/gpt-5.6-sol", name: "gpt-5.6-sol" },
  ],
  free: [
    { id: "cline-free/longcat-2.0", name: "LongCat-2.0" },
    { id: "z-ai/glm-5.3-flash", name: "glm-5.3-flash" },
    { id: "deepseek/deepseek-v4-flash", name: "deepseek-v4-flash" },
    { id: "poolside/laguna-s-2.1:free", name: "laguna-s-2.1:free" },
  ],
  clinePass: [
    { id: "cline-pass/glm-5.3-flash", name: "ClinePass GLM" },
  ],
};

const CLINE_CONNECTION = {
  id: "cline-connection",
  provider: "cline",
  isActive: true,
  providerSpecificData: {},
};

const PROXY_OPTIONS = {
  connectionProxyEnabled: true,
  connectionProxyUrl: "http://proxy.example:8080",
  connectionNoProxy: "localhost",
  vercelRelayUrl: "https://relay.example",
  strictProxy: true,
};

function successfulResponse(payload = OFFICIAL_PAYLOAD) {
  return {
    ok: true,
    json: vi.fn(async () => payload),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  connectionsMock.mockResolvedValue([CLINE_CONNECTION]);
  customModelsMock.mockResolvedValue([]);
  resolveProxyMock.mockResolvedValue(PROXY_OPTIONS);
  proxyAwareFetchMock.mockResolvedValue(successfulResponse());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Cline recommended model normalization", () => {
  it("keeps stable recommended then free order, dedupes first-wins, and excludes ClinePass", () => {
    const models = normalizeClineModels({
      recommended: [
        { id: "alpha", name: "Alpha" },
        null,
        { id: "" },
        { id: "cline-pass/not-allowed" },
      ],
      free: [
        { id: "alpha", name: "Duplicate" },
        { id: " beta ", name: " Beta " },
        { nope: true },
      ],
      clinePass: [{ id: "cline-pass/ignored" }],
    });

    expect(models).toEqual([
      { id: "alpha", name: "Alpha" },
      { id: "beta", name: "Beta" },
    ]);
  });

  it.each([null, [], {}, { recommended: {}, free: "bad" }])(
    "treats malformed payload %j as empty",
    (payload) => {
      expect(normalizeClineModels(payload)).toEqual([]);
    },
  );
});

describe("Cline recommended model transport", () => {
  it("uses the public endpoint without credentials and forwards strict proxy policy", async () => {
    const result = await resolveClineModels({ proxyOptions: PROXY_OPTIONS });

    expect(result.models).toHaveLength(8);
    expect(proxyAwareFetchMock).toHaveBeenCalledWith(
      CLINE_RECOMMENDED_MODELS_ENDPOINT,
      expect.objectContaining({
        method: "GET",
        headers: { Accept: "application/json" },
        signal: expect.any(AbortSignal),
      }),
      PROXY_OPTIONS,
    );
    expect(proxyAwareFetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("returns null for non-OK and invalid JSON responses", async () => {
    proxyAwareFetchMock
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: vi.fn(async () => { throw new SyntaxError("bad json"); }) });

    await expect(resolveClineModels()).resolves.toBeNull();
    await expect(resolveClineModels()).resolves.toBeNull();
  });

  it("clears its deadline after a strict-proxy rejection", async () => {
    vi.useFakeTimers();
    proxyAwareFetchMock.mockRejectedValue(new Error("strict proxy unavailable"));

    await expect(resolveClineModels({ proxyOptions: PROXY_OPTIONS })).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a hanging request at the bounded deadline and clears the timer", async () => {
    vi.useFakeTimers();
    proxyAwareFetchMock.mockImplementation((_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    }));

    const pending = resolveClineModels();
    await vi.advanceTimersByTimeAsync(5000);

    await expect(pending).resolves.toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Cline public models route", () => {
  it("replaces the static catalog with recommended plus free live models", async () => {
    const models = await buildModelsList(["llm"]);
    const ids = models.filter((model) => model.owned_by === "cl").map((model) => model.id);

    expect(ids).toEqual([
      "cl/moonshotai/kimi-k3",
      "cl/anthropic/claude-opus-5",
      "cl/x-ai/grok-4.5",
      "cl/openai/gpt-5.6-sol",
      "cl/cline-free/longcat-2.0",
      "cl/z-ai/glm-5.3-flash",
      "cl/deepseek/deepseek-v4-flash",
      "cl/poolside/laguna-s-2.1:free",
    ]);
    expect(ids.some((id) => id.includes("cline-pass/"))).toBe(false);
    expect(resolveProxyMock).toHaveBeenCalledWith({});
  });

  it("falls back to the static catalog when live discovery fails", async () => {
    proxyAwareFetchMock.mockRejectedValue(new Error("offline"));

    const models = await buildModelsList(["llm"]);
    const ids = models.filter((model) => model.owned_by === "cl").map((model) => model.id);

    expect(ids).toContain("cl/moonshotai/kimi-k3");
    expect(ids.length).toBeGreaterThan(0);
  });

  it("keeps explicit enabled models authoritative and skips live discovery", async () => {
    connectionsMock.mockResolvedValue([{
      ...CLINE_CONNECTION,
      providerSpecificData: { enabledModels: ["openai/gpt-5.4"] },
    }]);

    const models = await buildModelsList(["llm"]);
    const ids = models.filter((model) => model.owned_by === "cl").map((model) => model.id);

    expect(ids).toEqual(["cl/openai/gpt-5.4"]);
    expect(proxyAwareFetchMock).not.toHaveBeenCalled();
  });
});
