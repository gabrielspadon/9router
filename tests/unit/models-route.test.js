import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Fork mocks: buildModelsList imports from @/lib/localDb and
// @/lib/disabledModelsDb (not the upstream repos/* paths), and the combo
// enrichment path reads open-sse/providers/capabilities.
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn().mockResolvedValue([]),
  getCombos: vi.fn().mockResolvedValue([]),
  getCustomModels: vi.fn().mockResolvedValue([]),
  getModelAliases: vi.fn().mockResolvedValue({}),
  getFreeModels: vi.fn().mockResolvedValue({}),
  getSettings: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/shared/constants/models", () => ({
  PROVIDER_MODELS: {
    openai: [{ id: "gpt-x" }],
  },
  PROVIDER_ID_TO_ALIAS: {
    openai: "openai",
  },
  getModelKind: (m) => m?.kind || m?.type || null,
}));

vi.mock("@/shared/constants/providers", () => ({
  AI_PROVIDERS: {},
  FREE_PROVIDERS: {},
  FREE_TIER_PROVIDERS: {},
  getProviderAlias: vi.fn().mockReturnValue(null),
  isOpenAICompatibleProvider: vi.fn().mockReturnValue(false),
  isAnthropicCompatibleProvider: vi.fn().mockReturnValue(false),
}));

vi.mock("open-sse/providers/capabilities.js", () => ({
  capabilitiesFromServiceKind: vi.fn().mockReturnValue(null),
  getCapabilitiesForModel: vi.fn().mockReturnValue({
    vision: false,
    contextWindow: 128000,
    maxOutput: 16384,
  }),
}));

const { getProviderConnections, getCombos, getSettings } =
  await import("@/lib/localDb");
const { buildModelsList } = await import("@/app/api/v1/models/route.js");

describe("buildModelsList with exposeComboOnly", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProviderConnections.mockResolvedValue([]);
    getCombos.mockResolvedValue([]);
    getSettings.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("default-off includes Combo and provider model entries", async () => {
    getSettings.mockResolvedValue({ exposeComboOnly: false });
    getCombos.mockResolvedValue([
      { name: "my-combo", kind: "llm", models: ["openai/gpt-4"] },
    ]);
    getProviderConnections.mockResolvedValue([
      { provider: "openai", isActive: true, providerSpecificData: {} },
    ]);

    const result = await buildModelsList(["llm"]);

    const comboEntries = result.filter((m) => m.owned_by === "combo");
    const providerEntries = result.filter((m) => m.owned_by !== "combo");

    expect(comboEntries.length).toBeGreaterThan(0);
    expect(providerEntries.length).toBeGreaterThan(0);
  });

  it("enabled returns only kind-matching Combos, with fork enrichment intact", async () => {
    getSettings.mockResolvedValue({ exposeComboOnly: true });
    getCombos.mockResolvedValue([
      { name: "llm-combo", kind: "llm", models: ["openai/gpt-4"] },
      { name: "web-combo", kind: "webSearch", models: ["search-model"] },
    ]);
    getProviderConnections.mockResolvedValue([
      { provider: "openai", isActive: true, providerSpecificData: {} },
    ]);

    const result = await buildModelsList(["llm"]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "llm-combo",
      owned_by: "combo",
    });
    // Fork delta vs upstream: the early-return keeps the combo loop's
    // context_length / max_completion_tokens enrichment (upstream
    // comboToEntry would drop it).
    expect(result[0].context_length).toBe(128000);
    expect(result[0].max_completion_tokens).toBe(16384);
  });

  it("enabled with no kind-matching Combo produces empty list", async () => {
    getSettings.mockResolvedValue({ exposeComboOnly: true });
    getCombos.mockResolvedValue([
      { name: "web-combo", kind: "webSearch", models: ["search-model"] },
    ]);
    getProviderConnections.mockResolvedValue([
      { provider: "openai", isActive: true, providerSpecificData: {} },
    ]);

    const result = await buildModelsList(["llm"]);

    expect(result).toEqual([]);
  });

  it("enabled dedupes Combos sharing a name", async () => {
    getSettings.mockResolvedValue({ exposeComboOnly: true });
    getCombos.mockResolvedValue([
      { name: "dup-combo", kind: "llm", models: ["openai/gpt-4"] },
      { name: "dup-combo", kind: "llm", models: ["openai/gpt-4"] },
    ]);

    const result = await buildModelsList(["llm"]);

    expect(result).toHaveLength(1);
  });
});
