import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getFreeModels: vi.fn(),
  getModelAliases: vi.fn(),
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => dbMocks);
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));

import { AI_PROVIDERS, MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import { buildModelsList } from "@/app/api/v1/models/route.js";
import { GET as getModelsByKind } from "@/app/api/v1/models/[kind]/route.js";
import { GET as getModelInfo } from "@/app/api/v1/models/info/route.js";

beforeEach(() => {
  dbMocks.getProviderConnections.mockResolvedValue([]);
  dbMocks.getCombos.mockResolvedValue([]);
  dbMocks.getCustomModels.mockResolvedValue([]);
  dbMocks.getFreeModels.mockResolvedValue({});
  dbMocks.getModelAliases.mockResolvedValue({});
  dbMocks.getSettings.mockResolvedValue({});
});

describe("Mistral OCR and moderation discovery", () => {
  it("keeps non-chat models out of the default list and exposes them through their explicit kinds", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([{ provider: "mistral", isActive: true, providerSpecificData: {} }]);
    const defaultIds = (await buildModelsList(["llm"])).map((model) => model.id);
    expect(defaultIds).not.toContain("mistral/mistral-ocr-latest");
    expect(defaultIds).not.toContain("mistral/mistral-moderation-latest");

    const ocrResponse = await getModelsByKind(new Request("http://localhost/v1/models/ocr"), { params: Promise.resolve({ kind: "ocr" }) });
    const moderationResponse = await getModelsByKind(new Request("http://localhost/v1/models/moderation"), { params: Promise.resolve({ kind: "moderation" }) });
    expect(ocrResponse.status).toBe(200);
    expect(moderationResponse.status).toBe(200);
    await expect(ocrResponse.json()).resolves.toMatchObject({ data: [expect.objectContaining({ id: "mistral/mistral-ocr-latest" })] });
    await expect(moderationResponse.json()).resolves.toMatchObject({ data: [expect.objectContaining({ id: "mistral/mistral-moderation-latest" })] });
  });

  it("publishes the endpoint that matches each discovered kind", async () => {
    const ocrInfo = await getModelInfo(new Request("http://localhost/v1/models/info?id=mistral/mistral-ocr-latest"));
    const moderationInfo = await getModelInfo(new Request("http://localhost/v1/models/info?id=mistral/mistral-moderation-latest"));

    await expect(ocrInfo.json()).resolves.toMatchObject({ kind: "ocr", endpoint: "/v1/ocr" });
    await expect(moderationInfo.json()).resolves.toMatchObject({ kind: "moderation", endpoint: "/v1/moderations" });
  });

  it("carries both endpoint configs into the dashboard media registry", () => {
    expect(AI_PROVIDERS.mistral.ocrConfig?.baseUrl).toBe("https://api.mistral.ai/v1/ocr");
    expect(AI_PROVIDERS.mistral.moderationConfig?.baseUrl).toBe("https://api.mistral.ai/v1/moderations");
    expect(MEDIA_PROVIDER_KINDS).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "ocr", endpoint: { method: "POST", path: "/v1/ocr" } }),
      expect.objectContaining({ id: "moderation", endpoint: { method: "POST", path: "/v1/moderations" } }),
    ]));
  });
});
