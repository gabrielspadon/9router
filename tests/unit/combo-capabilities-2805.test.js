import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

const src = readFileSync(new URL("../../src/app/api/v1/models/route.js", import.meta.url), "utf8");

// The combo loop computed per-member caps and then discarded everything except
// the two token fields, so /v1/models advertised a combo with no capabilities
// block at all — clients could not tell whether a combo did vision or reasoning.
describe("combo entries expose intersected capabilities (#2805)", () => {
  it("keeps the per-member caps instead of dropping them", () => {
    expect(src).toContain("entry.capabilities = comboCaps");
  });

  it("uses the same emission condition a single-model entry uses", () => {
    expect(src).toContain("comboCaps.vision || comboCaps.search || comboCaps.reasoning");
    expect(src).toContain("caps.vision || caps.search || caps.reasoning");
  });

  it("intersects rather than unions: one text-only member clears the flag", () => {
    // Reproduce the loop's rule against real registry capabilities.
    const members = [["openai", "gpt-5.6-sol"], ["nvidia", "nvidia/nemotron-3-ultra-550b-a55b"]];
    let comboCaps = null;
    for (const [provider, model] of members) {
      const caps = getCapabilitiesForModel(provider, model);
      if (!caps) continue;
      if (comboCaps === null) {
        comboCaps = {};
        for (const [k, v] of Object.entries(caps)) if (typeof v === "boolean") comboCaps[k] = v;
      } else {
        for (const k of Object.keys(comboCaps)) if (caps[k] !== true) comboCaps[k] = false;
      }
    }
    expect(comboCaps).toBeTruthy();
    // nemotron is vision:false, so the combo must not advertise vision whatever
    // the first member offers.
    expect(getCapabilitiesForModel("nvidia", "nvidia/nemotron-3-ultra-550b-a55b").vision).toBe(false);
    expect(comboCaps.vision).toBe(false);
  });

  it("only intersects booleans, never thinkingFormat or a window", () => {
    const caps = getCapabilitiesForModel("nvidia", "z-ai/glm-5.2");
    const booleans = Object.entries(caps).filter(([, v]) => typeof v === "boolean").map(([k]) => k);
    expect(booleans).toContain("vision");
    expect(booleans).toContain("reasoning");
    expect(booleans).not.toContain("thinkingFormat");
    expect(booleans).not.toContain("contextWindow");
  });
});
