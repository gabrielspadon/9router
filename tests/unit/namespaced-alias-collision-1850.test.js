import { describe, it, expect, vi, beforeEach } from "vitest";

// #1850 asks that a namespaced model id stay importable when an already-added
// model shares its final path segment (`enx/gpt-5.5` vs `enx/codebuddy/gpt-5.5`).
// The upstream failure came from an importer that reduced the id to its last
// segment to propose an alias, then gave up once every proposal was taken.
// This fork has no such importer: nothing derives an alias from a model id, and
// every store keys on the id verbatim. These cases pin that, because the defect
// would return the moment any of these paths starts splitting on the last slash.

const store = { custom: [] };

vi.mock("@/models", () => ({
  getCustomModels: vi.fn(async () => store.custom),
  addCustomModel: vi.fn(async ({ providerAlias, id, type = "llm", name }) => {
    const key = `${providerAlias}|${id}|${type}`;
    if (store.custom.some((m) => `${m.providerAlias}|${m.id}|${m.type}` === key)) return false;
    store.custom.push({ providerAlias, id, type, name: name || id });
    return true;
  }),
  deleteCustomModel: vi.fn(async () => {}),
}));
vi.mock("@/lib/modelCapabilityOverrides", () => ({
  refreshModelCapabilityOverrides: vi.fn(async () => {}),
}));

const { POST } = await import("@/app/api/models/custom/route.js");
const { parseModel, resolveModelAliasFromMap } = await import("open-sse/services/model.js");
const { getProviderCustomModelRows } = await import("@/shared/utils/providerCustomModels");

const post = (body) => POST({ json: async () => body });

const SIBLINGS = ["gpt-5.5", "codebuddy/gpt-5.5"];

beforeEach(() => {
  store.custom = [];
});

describe("namespaced model ids that share a final path segment (#1850)", () => {
  it("imports both siblings under one provider", async () => {
    for (const id of SIBLINGS) {
      const res = await post({ providerAlias: "enx", id });
      const body = await res.json();
      expect(body.error).toBeUndefined();
      expect(body.added).toBe(true);
    }
    expect(store.custom.map((m) => m.id)).toEqual(SIBLINGS);
  });

  it("stores the namespaced id verbatim rather than its last segment", async () => {
    await post({ providerAlias: "enx", id: "codebuddy/gpt-5.5" });
    expect(store.custom[0].id).toBe("codebuddy/gpt-5.5");
  });

  it("keeps the two siblings as distinct rows in the provider model list", async () => {
    for (const id of SIBLINGS) await post({ providerAlias: "enx", id });
    const rows = getProviderCustomModelRows({
      customModels: store.custom,
      modelAliases: {},
      providerAlias: "enx",
      type: "llm",
    });
    expect(rows.map((r) => r.fullModel)).toEqual([
      "enx/gpt-5.5",
      "enx/codebuddy/gpt-5.5",
    ]);
  });

  it("routes each sibling to its own upstream id (split on the first slash)", () => {
    expect(parseModel("enx/gpt-5.5").model).toBe("gpt-5.5");
    expect(parseModel("enx/codebuddy/gpt-5.5").model).toBe("codebuddy/gpt-5.5");
    expect(parseModel("enx/codebuddy/gpt-5.5").providerAlias).toBe("enx");
  });

  it("resolves two aliases pointing at siblings to different models", () => {
    const aliases = {
      "gpt-5.5": "enx/gpt-5.5",
      "cb-gpt-5.5": "enx/codebuddy/gpt-5.5",
    };
    expect(resolveModelAliasFromMap("gpt-5.5", aliases).model).toBe("gpt-5.5");
    expect(resolveModelAliasFromMap("cb-gpt-5.5", aliases).model).toBe("codebuddy/gpt-5.5");
  });
});
