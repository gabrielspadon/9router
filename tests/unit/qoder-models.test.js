import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => mocks.proxyAwareFetch(...args),
}));

vi.mock("../../open-sse/shared/qoder/cosy.js", () => ({
  buildCosyHeaders: () => ({}),
}));

const {
  clearQoderCatalog,
  getQoderModelConfig,
  resolveQoderModels,
} = await import("../../open-sse/services/qoderModels.js");

const credentials = {
  accessToken: "dt-test-token",
  providerSpecificData: { userId: "user-1", machineId: "machine-1" },
};

const listedModel = {
  key: "qmodel_latest",
  enable: true,
  display_name: "Qoder Latest",
  max_input_tokens: 200_000,
  max_output_tokens: 16_000,
  is_vl: false,
  is_reasoning: true,
  model_config: { routing: "latest" },
};

beforeEach(() => {
  clearQoderCatalog();
  mocks.proxyAwareFetch.mockReset();
});

afterEach(() => clearQoderCatalog());

describe("Qoder cmodel catalog fallback", () => {
  it("creates a usable Cantus config when the live catalog omits cmodel", async () => {
    mocks.proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ chat: [listedModel] }),
    });

    const catalog = await resolveQoderModels(credentials);

    expect(catalog.models).toContainEqual(expect.objectContaining({
      id: "cmodel",
      name: "Cantus",
      contextLength: listedModel.max_input_tokens,
      isReasoning: true,
    }));
    await expect(getQoderModelConfig(credentials, "cmodel")).resolves.toEqual({
      ...listedModel,
      key: "cmodel",
      display_name: "Cantus",
    });
  });
});
