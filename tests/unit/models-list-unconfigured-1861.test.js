import { describe, it, expect, vi, beforeEach } from "vitest";

// #1861 "why are model IDs that aren't enabled being displayed in the model
// list on the frontend client? ... there are models here that simply can't be
// used at all". The static-catalogue dump is a fail-open for an unreadable
// connection store, but it was gated on an empty connection list, which is also
// what a healthy store reports for an install with nothing configured.
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

describe("/v1/models on an install with nothing configured (#1861)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not advertise providers the user holds no credential for", async () => {
    getProviderConnections.mockResolvedValue([]);

    const listed = ids(await buildModelsList(["llm"]));

    expect(listed.some((id) => id.startsWith("anthropic/"))).toBe(false);
    expect(listed.some((id) => id.startsWith("groq/"))).toBe(false);
  });

  it("still advertises what needs no credential", async () => {
    // The point is not an empty list: a provider that needs no key is usable
    // with nothing configured, so removing it would be the opposite defect.
    getProviderConnections.mockResolvedValue([]);

    const listed = ids(await buildModelsList(["tts"]));

    expect(listed.some((id) => id.startsWith("edge-tts/"))).toBe(true);
  });

  it("a connection store that cannot be read still fails open to the catalogue", async () => {
    getProviderConnections.mockRejectedValue(new Error("db unavailable"));

    const listed = ids(await buildModelsList(["llm"]));

    expect(listed.some((id) => id.startsWith("anthropic/"))).toBe(true);
  });

  it("a deactivated connection is not a configured provider", async () => {
    getProviderConnections.mockResolvedValue([
      { id: "c1", provider: "anthropic", isActive: false, providerSpecificData: {} },
    ]);

    const listed = ids(await buildModelsList(["llm"]));

    expect(listed.some((id) => id.startsWith("anthropic/"))).toBe(false);
  });
});
