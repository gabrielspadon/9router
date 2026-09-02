import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getCustomModels: vi.fn(),
}));

const { getCustomModels } = await import("@/lib/localDb");
const { GET } = await import("../../src/app/api/v1/models/info/route.js");

describe("custom model metadata through /v1/models/info (#1347)", () => {
  beforeEach(() => {
    getCustomModels.mockResolvedValue([
      {
        providerAlias: "openai",
        id: "acme-internal",
        type: "llm",
        name: "Acme Internal",
        maxInputTokens: 321_000,
        maxOutputTokens: 12_345,
      },
      {
        providerAlias: "openai",
        id: "acme-internal",
        type: "embedding",
        name: "Acme Internal Embed",
      },
    ]);
  });

  it("resolves persisted custom limits for its provider-qualified id", async () => {
    const response = await GET(new Request("http://localhost/v1/models/info?id=openai/acme-internal"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: "openai/acme-internal",
      name: "Acme Internal",
      kind: "llm",
      contextWindow: 321_000,
      capabilities: {
        contextWindow: 321_000,
        maxOutput: 12_345,
      },
    });
  });

  it("selects the persisted row matching the requested kind", async () => {
    const response = await GET(new Request("http://localhost/v1/models/info?id=openai/acme-internal&kind=embedding"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: "openai/acme-internal",
      name: "Acme Internal Embed",
      kind: "embedding",
    });
  });
});
