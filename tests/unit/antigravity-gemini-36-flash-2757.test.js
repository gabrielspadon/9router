import { describe, expect, it } from "vitest";

import { getModelUpstreamId, isValidModel, getDefaultModel } from "../../open-sse/config/providerModels.js";
import antigravity from "../../open-sse/providers/registry/antigravity.js";

// #2757: Gemini 3.6 Flash is GA and clients ask for the bare published name.
// Antigravity has no bare key for it — the IDE sends gemini-3.6-flash-tiered
// plus a thinkingLevel (src/mitm/config.js extractModel) — so the bare id must
// route onto the tiered key instead of reaching upstream verbatim.
const TIERS = {
  "gemini-3.6-flash-high": "gemini-3.6-flash-tiered(high)",
  "gemini-3.6-flash-medium": "gemini-3.6-flash-tiered(medium)",
  "gemini-3.6-flash-low": "gemini-3.6-flash-tiered(low)",
};

describe("ag/gemini-3.6-flash (#2757)", () => {
  it("is a routable model id", () => {
    expect(isValidModel("ag", "gemini-3.6-flash")).toBe(true);
  });

  it("never reaches upstream under the bare GA name", () => {
    const upstream = getModelUpstreamId("ag", "gemini-3.6-flash");
    expect(upstream).not.toBe("gemini-3.6-flash");
    expect(upstream).toBe("gemini-3.6-flash-tiered(medium)");
  });

  it.each(Object.entries(TIERS))("leaves %s resolving to %s", (id, upstream) => {
    expect(getModelUpstreamId("ag", id)).toBe(upstream);
  });

  it("does not become the provider default", () => {
    expect(getDefaultModel("ag")).not.toBe("gemini-3.6-flash");
  });

  it("is listed once, so the catalogue shows it beside the tiers", () => {
    const ids = antigravity.models.map((m) => m.id);
    expect(ids.filter((id) => id === "gemini-3.6-flash")).toHaveLength(1);
    for (const tier of Object.keys(TIERS)) expect(ids).toContain(tier);
  });
});
