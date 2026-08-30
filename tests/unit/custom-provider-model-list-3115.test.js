import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  aliasesMock,
  connectionsMock,
  customModelsMock,
  fetchMock,
  providerConnectionMock,
  rewriteModelsMock,
} = vi.hoisted(() => ({
  aliasesMock: vi.fn(),
  connectionsMock: vi.fn(),
  customModelsMock: vi.fn(),
  fetchMock: vi.fn(),
  providerConnectionMock: vi.fn(),
  rewriteModelsMock: vi.fn((models) => models.map((model) => ({
    ...model,
    id: `claude-${model.id}`,
  }))),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: connectionsMock,
  getCombos: vi.fn(async () => []),
  getCustomModels: customModelsMock,
  getModelAliases: aliasesMock,
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
  resolveConnectionProxyConfig: vi.fn(() => null),
}));

vi.mock("@/models", () => ({
  getProviderConnectionById: providerConnectionMock,
}));

vi.mock("@/lib/claudeCompat", () => ({
  readClaudeCompat: vi.fn(() => ({ enabled: true })),
  rewriteModelsListForClaude: rewriteModelsMock,
}));

const {
  GET: getPublicModels,
  buildModelsList,
} = await import("../../src/app/api/v1/models/route.js");
const { GET: getProviderModels } = await import(
  "../../src/app/api/providers/[id]/models/route.js"
);

const PROVIDER_ID = "openai-compatible-chat-11111111";

const connection = {
  provider: PROVIDER_ID,
  isActive: true,
  apiKey: "sk-test",
  providerSpecificData: { prefix: "hn", apiType: "chat", baseUrl: "https://api.example.com/v1" },
};

// The upstream catalog the provider's own /models endpoint advertises.
const UPSTREAM = ["keep-me", "drop-me-1", "drop-me-2"];

function idsFor(models) {
  return models.filter(m => m.id.startsWith("hn/")).map(m => m.id.slice(3));
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = fetchMock;
  connectionsMock.mockResolvedValue([connection]);
  customModelsMock.mockResolvedValue([]);
  aliasesMock.mockResolvedValue({});
  providerConnectionMock.mockResolvedValue(connection);
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ data: UPSTREAM.map(id => ({ id })) }),
  });
});

describe("compatible-provider public model allowlists", () => {
  it("lists only models explicitly saved under the provider id", async () => {
    customModelsMock.mockResolvedValue([
      { providerAlias: PROVIDER_ID, id: "keep-me", type: "llm" },
    ]);

    const data = await buildModelsList(["llm"]);

    expect(idsFor(data)).toEqual(["keep-me"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps an empty Available Models list empty without upstream discovery", async () => {
    const data = await buildModelsList(["llm"]);

    expect(idsFor(data)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not leak stale enabledModels when the explicit list is empty", async () => {
    connectionsMock.mockResolvedValue([{
      ...connection,
      providerSpecificData: {
        ...connection.providerSpecificData,
        enabledModels: ["stale-model"],
      },
    }]);

    const data = await buildModelsList(["llm"]);

    expect(idsFor(data)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("supports legacy display-prefix custom models and explicit aliases", async () => {
    customModelsMock.mockResolvedValue([
      { providerAlias: "hn", id: "legacy-custom", type: "llm" },
    ]);
    aliasesMock.mockResolvedValue({ shortcut: `${PROVIDER_ID}/aliased-model` });

    const data = await buildModelsList(["llm"]);

    expect(idsFor(data)).toEqual(["legacy-custom", "aliased-model"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("applies the same allowlist rule to Anthropic-compatible providers", async () => {
    const providerId = "anthropic-compatible-chat-22222222";
    connectionsMock.mockResolvedValue([{
      ...connection,
      provider: providerId,
      providerSpecificData: {
        prefix: "acme-claude",
        baseUrl: "https://anthropic.example.com/v1/messages",
      },
    }]);
    customModelsMock.mockResolvedValue([
      { providerAlias: providerId, id: "claude-private", type: "llm" },
    ]);

    const data = await buildModelsList(["llm"]);

    expect(data.map((model) => model.id)).toEqual(["acme-claude/claude-private"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves built-in provider static catalogs", async () => {
    connectionsMock.mockResolvedValue([{
      provider: "openai",
      isActive: true,
      providerSpecificData: {},
    }]);

    const data = await buildModelsList(["llm"]);

    expect(data.some((model) => model.id.startsWith("openai/"))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves explicit import discovery on the provider models route", async () => {
    const response = await getProviderModels(new Request("http://localhost"), {
      params: Promise.resolve({ id: "connection-1" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      provider: PROVIDER_ID,
      models: UPSTREAM.map((id) => ({ id })),
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer sk-test" }),
      }),
    );
  });

  it("preserves Claude-compatible rewriting and final sorting", async () => {
    customModelsMock.mockResolvedValue([
      { providerAlias: PROVIDER_ID, id: "zeta", type: "llm" },
      { providerAlias: PROVIDER_ID, id: "alpha", type: "llm" },
    ]);

    const response = await getPublicModels(new Request("http://localhost/v1/models", {
      headers: { "anthropic-version": "2023-06-01" },
    }));
    const body = await response.json();

    expect(rewriteModelsMock).toHaveBeenCalledTimes(1);
    expect(body.data.map((model) => model.id)).toEqual([
      "claude-hn/alpha",
      "claude-hn/zeta",
    ]);
  });
});
