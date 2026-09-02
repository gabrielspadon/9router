import { describe, it, expect, vi, beforeEach } from "vitest";

// #2114: creating a combo should start from a model that still has quota rather
// than from an empty selection. This is the data half — one call that names the
// first member a new combo can safely take, skipping anything /api/models/
// availability reports as on cooldown or unavailable, and skipping combos so the
// seed can never be a routing cycle.

const state = { models: [], availability: [], availabilityOk: true };

vi.mock("@/app/api/v1/models/route.js", () => ({
  buildModelsList: vi.fn(async () => state.models),
}));
vi.mock("@/app/api/models/availability/route.js", () => ({
  GET: vi.fn(async () => ({
    ok: state.availabilityOk,
    json: async () => ({ models: state.availability }),
  })),
}));

const { GET, pickFirstAvailableModel } = await import("@/app/api/combos/default-model/route.js");

const entry = (id, owner) => ({ id, object: "model", owned_by: owner ?? id.split("/")[0] });

beforeEach(() => {
  state.models = [
    { id: "my-combo", object: "model", owned_by: "combo" },
    entry("kc/z-ai/glm-4.6:free"),
    entry("cx/gpt-5.5"),
  ];
  state.availability = [];
  state.availabilityOk = true;
});

describe("default model for a new combo (#2114)", () => {
  it("returns the first listed model when nothing is exhausted", async () => {
    expect(await (await GET()).json()).toEqual({ model: "kc/z-ai/glm-4.6:free" });
  });

  it("never seeds a combo with another combo", async () => {
    state.models = [{ id: "my-combo", object: "model", owned_by: "combo" }];
    expect(await (await GET()).json()).toEqual({ model: null, reason: "no-available-model" });
  });

  it("skips a model that is on cooldown", async () => {
    state.availability = [
      { provider: "kilocode", model: "z-ai/glm-4.6:free", status: "cooldown" },
    ];
    expect((await (await GET()).json()).model).toBe("cx/gpt-5.5");
  });

  it("skips every model of a provider reported unavailable account-wide", async () => {
    state.availability = [{ provider: "kilocode", model: "__all", status: "unavailable" }];
    expect((await (await GET()).json()).model).toBe("cx/gpt-5.5");
  });

  it("reports no-available-model when every candidate is exhausted", async () => {
    state.availability = [
      { provider: "kilocode", model: "__all", status: "unavailable" },
      { provider: "codex", model: "gpt-5.5", status: "cooldown" },
    ];
    expect(await (await GET()).json()).toEqual({ model: null, reason: "no-available-model" });
  });

  it("fails open when the availability list cannot be read", async () => {
    state.availabilityOk = false;
    expect((await (await GET()).json()).model).toBe("kc/z-ai/glm-4.6:free");
  });

  it("matches an unavailability reported under the provider id or its alias", () => {
    const models = [entry("kc/a"), entry("kc/b")];
    expect(pickFirstAvailableModel(models, [{ provider: "kc", model: "a" }])).toBe("kc/b");
    expect(pickFirstAvailableModel(models, [{ provider: "kilocode", model: "a" }])).toBe("kc/b");
  });
});
