import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// #1995: Kilo Code's dynamically fetched free models never reached the combo
// model selector. ModelSelectModal assembles a passthroughModels provider's list
// from modelAliases + customModels + the hardcoded registry entry, so the fix is
// for the free-model sync to land the fetched catalog in customModels under the
// same alias the selector groups by. kilocode is category "oauth", which the
// original target filter excluded; it is admitted by the "*-free" fetcher-type
// clause because its catalog endpoint is public and already price-filtered.

const store = {
  settings: {},
  free: {},
  custom: [],
  deleted: [],
};

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => store.settings),
  getFreeModels: vi.fn(async () => store.free),
  getFreeModelsForProvider: vi.fn(async (id) => store.free[id] || null),
  setFreeModels: vi.fn(async (id, ids) => {
    store.free[id] = { ids, updatedAt: new Date().toISOString() };
  }),
  addCustomModel: vi.fn(async (m) => {
    store.custom.push(m);
    return true;
  }),
  deleteCustomModel: vi.fn(async (m) => {
    store.deleted.push(m);
  }),
  getComboById: vi.fn(async () => null),
  updateCombo: vi.fn(async () => {}),
}));

const { getSyncTargets, runFreeModelSync } = await import("@/shared/services/freeModelSync.js");

const KILO_URL = "https://api.kilo.ai/api/gateway/models";
const kiloModel = (id, name) => ({
  id,
  name,
  pricing: { prompt: "0", completion: "0" },
  context_length: 1000000,
});

let realFetch;

beforeEach(() => {
  store.settings = {};
  store.free = {};
  store.custom = [];
  store.deleted = [];
  realFetch = globalThis.fetch;
  // Only Kilo's catalog answers; every other target fails and is isolated.
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url) !== KILO_URL) throw new Error("offline");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          kiloModel("z-ai/glm-4.6:free", "GLM 4.6 (free)"),
          kiloModel("deepseek/deepseek-chat-v3:free", "DeepSeek V3 (free)"),
        ],
      }),
    };
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("Kilo Code free models reach the combo selector (#1995)", () => {
  it("includes kilocode in the sync targets despite category oauth", () => {
    const kilo = getSyncTargets().find((t) => t.id === "kilocode");
    expect(kilo).toBeDefined();
    expect(kilo.category).toBe("oauth");
    expect(kilo.modelsFetcher.type.endsWith("-free")).toBe(true);
    expect(kilo.passthroughModels).toBe(true);
  });

  it("writes the fetched catalog into customModels under the selector's alias", async () => {
    await runFreeModelSync();
    const kiloCustoms = store.custom.filter((m) => m.providerAlias === "kc");
    expect(kiloCustoms.map((m) => m.id)).toEqual([
      "z-ai/glm-4.6:free",
      "deepseek/deepseek-chat-v3:free",
    ]);
    expect(kiloCustoms.every((m) => m.type === "llm")).toBe(true);
  });

  it("persists the catalog per provider id and isolates other providers' failures", async () => {
    const result = await runFreeModelSync();
    expect(store.free.kilocode.ids).toHaveLength(2);
    expect(result.providers.kilocode).toMatchObject({ count: 2, added: 2 });
  });

  it("re-syncs without duplicating models already captured by the last snapshot", async () => {
    await runFreeModelSync();
    store.custom = [];
    await runFreeModelSync();
    expect(store.custom.filter((m) => m.providerAlias === "kc")).toHaveLength(0);
    expect(store.deleted).toHaveLength(0);
  });
});
