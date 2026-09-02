import { describe, it, expect, vi, beforeEach } from "vitest";

// #2702, thinking-mode half. getThinkingLevels already knows the reasoning
// ladder for a model and the router already accepts the "model(level)" suffix,
// but /v1/models listed only the bare id, so a client had to guess the exact
// string instead of discovering it.
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn().mockResolvedValue([]),
  getCombos: vi.fn().mockResolvedValue([]),
  getCustomModels: vi.fn().mockResolvedValue([]),
  getModelAliases: vi.fn().mockResolvedValue({}),
  getFreeModels: vi.fn().mockResolvedValue({}),
  getSettings: vi.fn().mockResolvedValue({}),
  updateConnectionProxyPoolSnapshotIfBound: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn().mockResolvedValue({}),
}));

const { getProviderConnections } = await import("@/lib/localDb");
const { buildModelsList } = await import("@/app/api/v1/models/route.js");
const { getThinkingLevels } = await import("open-sse/providers/thinkingLevels.js");

// gpt-5 declares a ladder, gpt-4o declares none — same provider, so one
// connection exercises both sides of the guard.
const LADDER_MODEL = "gpt-5";
const PLAIN_MODEL = "gpt-4o";

const listOpenAI = async () => {
  getProviderConnections.mockResolvedValue([
    {
      id: "c1",
      provider: "openai",
      isActive: true,
      providerSpecificData: { enabledModels: [LADDER_MODEL, PLAIN_MODEL] },
    },
  ]);
  return await buildModelsList(["llm"], { thinkingVariants: true });
};

describe("/v1/models exposes thinking-level variants (#2702)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fixture check: one model has a ladder, the other has none", () => {
    expect(getThinkingLevels("openai", LADDER_MODEL)?.length).toBeGreaterThan(0);
    expect(getThinkingLevels("openai", PLAIN_MODEL)).toBeNull();
  });

  it("lists one entry per level getThinkingLevels reports, keeping the bare id", async () => {
    const ids = (await listOpenAI()).map((m) => m.id);
    const levels = getThinkingLevels("openai", LADDER_MODEL);

    expect(ids).toContain(`openai/${LADDER_MODEL}`);
    expect(
      ids.filter((id) => id.startsWith(`openai/${LADDER_MODEL}(`)),
    ).toEqual(levels.map((l) => `openai/${LADDER_MODEL}(${l})`));
  });

  it("gives a model with no ladder no extra entries", async () => {
    const ids = (await listOpenAI()).map((m) => m.id);

    expect(ids).toContain(`openai/${PLAIN_MODEL}`);
    expect(ids.filter((id) => id.startsWith(`openai/${PLAIN_MODEL}(`))).toEqual([]);
  });

  it("carries the base model's metadata onto each variant", async () => {
    const list = await listOpenAI();
    const base = list.find((m) => m.id === `openai/${LADDER_MODEL}`);
    const variant = list.find((m) => m.id.startsWith(`openai/${LADDER_MODEL}(`));

    expect(variant).toBeTruthy();
    expect(variant.owned_by).toBe(base.owned_by);
    expect(variant.context_length).toBe(base.context_length);
    expect(variant.capabilities).toEqual(base.capabilities);
  });
  it("keeps the variants out of the catalogue internal consumers read", async () => {
    // The auto-router, combo suggester and dashboard picker all call
    // buildModelsList; six spellings of one model would be six candidates.
    getProviderConnections.mockResolvedValue([
      {
        id: "c1",
        provider: "openai",
        isActive: true,
        providerSpecificData: { enabledModels: [LADDER_MODEL] },
      },
    ]);

    const ids = (await buildModelsList(["llm"])).map((m) => m.id);

    expect(ids).toContain(`openai/${LADDER_MODEL}`);
    expect(ids.filter((id) => id.includes("("))).toEqual([]);
  });
});
