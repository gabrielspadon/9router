import { describe, it, expect, vi, beforeEach } from "vitest";

// #2702 "Endpoint /v1/models not list all the model from providers".
// Two independent reasons a routable model never reached the listing, both in
// buildModelsList's per-provider loop, which walked stored connections only.
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

const ids = (list) => list.map((m) => m.id);

describe("/v1/models lists every routable model (#2702)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProviderConnections.mockResolvedValue([]);
  });

  it("keeps credential-free providers once another provider is connected", async () => {
    // edge-tts / google-tts need no credential, so they never get a stored
    // connection and the loop over connections dropped them entirely.
    getProviderConnections.mockResolvedValue([
      { id: "c1", provider: "openrouter", isActive: true, providerSpecificData: {} },
    ]);

    const listed = ids(await buildModelsList(["tts"]));

    expect(listed.some((id) => id.startsWith("edge-tts/"))).toBe(true);
    expect(listed.some((id) => id.startsWith("google-tts/"))).toBe(true);
  });

  it("keeps a credential-free web-search provider as its own entry", async () => {
    getProviderConnections.mockResolvedValue([
      { id: "c1", provider: "openrouter", isActive: true, providerSpecificData: {} },
    ]);

    const listed = ids(await buildModelsList(["webSearch"]));

    expect(listed).toContain("searxng/search");
    expect(listed).toContain("ddgs/search");
  });

  it("unions enabledModels across every account of one provider", async () => {
    // enabledModels is read by this listing and nowhere else, so a model
    // selected on the second account is routable but was invisible.
    getProviderConnections.mockResolvedValue([
      {
        id: "c1",
        provider: "anthropic",
        isActive: true,
        providerSpecificData: { enabledModels: ["only-on-account-one"] },
      },
      {
        id: "c2",
        provider: "anthropic",
        isActive: true,
        providerSpecificData: { enabledModels: ["only-on-account-two"] },
      },
    ]);

    const listed = ids(await buildModelsList(["llm"]));

    expect(listed).toContain("anthropic/only-on-account-one");
    expect(listed).toContain("anthropic/only-on-account-two");
  });

  it("an account that selected nothing lifts the restriction rather than adding to it", async () => {
    // A second account with no explicit selection serves the whole catalogue,
    // so the provider must fall back to its full static list, not to the union.
    getProviderConnections.mockResolvedValue([
      {
        id: "c1",
        provider: "anthropic",
        isActive: true,
        providerSpecificData: { enabledModels: ["only-on-account-one"] },
      },
      { id: "c2", provider: "anthropic", isActive: true, providerSpecificData: {} },
    ]);

    const listed = ids(await buildModelsList(["llm"]));

    expect(listed).not.toContain("anthropic/only-on-account-one");
    expect(listed.filter((id) => id.startsWith("anthropic/")).length).toBeGreaterThan(1);
  });
});
