import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: dbMocks.getProviderConnections,
  getCombos: dbMocks.getCombos,
  getCustomModels: dbMocks.getCustomModels,
  getModelAliases: dbMocks.getModelAliases,
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn().mockResolvedValue({}),
}));

vi.mock("open-sse/services/kiroModels.js", () => ({
  resolveKiroModels: vi.fn(),
}));

vi.mock("open-sse/services/qoderModels.js", () => ({
  resolveQoderModels: vi.fn(),
}));

const originalFetch = global.fetch;

describe("/v1/models compatible live catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getCombos.mockResolvedValue([]);
    dbMocks.getCustomModels.mockResolvedValue([]);
    dbMocks.getModelAliases.mockResolvedValue({});
    dbMocks.getProviderConnections.mockResolvedValue([
      {
        id: "conn-live-compatible",
        provider: "openai-compatible-chat-11111111-2222-4333-8444-555555555555",
        apiKey: "sk-upstream",
        isActive: true,
        providerSpecificData: {
          prefix: "live-compatible",
          baseUrl: "https://openai-compatible.example/v1",
        },
      },
    ]);

    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      object: "list",
      data: [
        { id: "gpt-5.4" },
        { id: "gpt-5.4-mini" },
        { id: "gpt-5.5" },
      ],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("fetches live models for UUID-backed compatible providers", async () => {
    const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

    const models = await buildModelsList(["llm"]);
    const ids = models.map((m) => m.id);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://openai-compatible.example/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer sk-upstream" }),
      }),
    );
    expect(ids).toContain("live-compatible/gpt-5.4");
    expect(ids).toContain("live-compatible/gpt-5.4-mini");
    expect(ids).toContain("live-compatible/gpt-5.5");
  });

  it("returns info for live compatible-provider models", async () => {
    const { GET } = await import("../../src/app/api/v1/models/info/route.js");

    const response = await GET(new Request("http://localhost/v1/models/info?id=live-compatible/gpt-5.4-mini"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: "live-compatible/gpt-5.4-mini",
      name: "gpt-5.4-mini",
      kind: "llm",
      owned_by: "live-compatible",
      endpoint: "/v1/chat/completions",
    });
  });

  it("returns upstream capability metadata for live models when providers include it", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({
      object: "list",
      data: [
        {
          id: "gpt-5.5",
          modalities: { input: ["text", "image"], output: ["text"] },
          capabilities: { reasoning: true, tool_calls: true },
        },
      ],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const { GET } = await import("../../src/app/api/v1/models/info/route.js");
    const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

    const models = await buildModelsList(["llm"]);
    const response = await GET(new Request("http://localhost/v1/models/info?id=live-compatible/gpt-5.5"));
    const body = await response.json();

    expect(models.find((model) => model.id === "live-compatible/gpt-5.5")?.capabilities).toMatchObject({
      vision: true,
      reasoning: true,
      tools: true,
    });
    expect(response.status).toBe(200);
    expect(body.capabilities).toMatchObject({
      vision: true,
      reasoning: true,
      tools: true,
    });
  });

  it("falls back to runtime capabilities for live GPT models", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([
      {
        id: "conn-runtime-compatible",
        provider: "openai-compatible-chat-99999999-8888-4777-8666-555555555555",
        apiKey: "sk-runtime-compatible",
        isActive: true,
        providerSpecificData: {
          prefix: "runtime-compatible",
          baseUrl: "https://runtime-compatible.example/v1",
        },
      },
    ]);
    const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");
    const { GET } = await import("../../src/app/api/v1/models/info/route.js");

    const models = await buildModelsList(["llm"]);
    const response = await GET(new Request("http://localhost/v1/models/info?id=runtime-compatible/gpt-5.5"));
    const body = await response.json();

    expect(models.map((m) => m.id)).toEqual(expect.arrayContaining([
      "runtime-compatible/gpt-5.4",
      "runtime-compatible/gpt-5.4-mini",
      "runtime-compatible/gpt-5.5",
    ]));
    expect(response.status).toBe(200);
    expect(models.find((model) => model.id === "runtime-compatible/gpt-5.5")?.capabilities).toMatchObject({
      vision: true,
      reasoning: true,
      thinkingFormat: "openai",
    });
    expect(body).toMatchObject({
      id: "runtime-compatible/gpt-5.5",
      kind: "llm",
      endpoint: "/v1/chat/completions",
      owned_by: "runtime-compatible",
      capabilities: {
        vision: true,
        reasoning: true,
        thinkingFormat: "openai",
      },
    });
  });

  it("returns 404 when compatible live catalog does not include the requested model", async () => {
    const { GET } = await import("../../src/app/api/v1/models/info/route.js");

    const response = await GET(new Request("http://localhost/v1/models/info?id=live-compatible/not-real"));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.message).toBe("Model not found: live-compatible/not-real");
  });

  it("honors requested kind for compatible live catalog model info", async () => {
    const { GET } = await import("../../src/app/api/v1/models/info/route.js");

    const response = await GET(new Request("http://localhost/v1/models/info?id=live-compatible/gpt-5.4-mini&kind=embedding"));

    expect(response.status).toBe(404);
  });

  it("normalizes Anthropic-compatible message endpoints before fetching models", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([
      {
        id: "conn-anthropic-compatible",
        provider: "anthropic-compatible-chat-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        apiKey: "sk-anthropic",
        isActive: true,
        providerSpecificData: {
          prefix: "ant-compat",
          baseUrl: "https://anthropic.example/v1/messages",
        },
      },
    ]);

    const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

    await buildModelsList(["llm"]);

    expect(global.fetch).toHaveBeenCalledWith(
      "https://anthropic.example/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "x-api-key": "sk-anthropic",
          "anthropic-version": "2023-06-01",
          Authorization: "Bearer sk-anthropic",
        }),
      }),
    );
  });
});
