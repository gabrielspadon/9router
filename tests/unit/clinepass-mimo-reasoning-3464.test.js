import { describe, it, expect } from "vitest";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";

describe("ClinePass MiMo V2.5 reasoning control (#3464)", () => {
  for (const id of ["cline-pass/mimo-v2.5", "cline-pass/mimo-v2.5-pro"]) {
    it(`offers low, medium and high on ${id}`, () => {
      expect(getThinkingLevels("clinepass", id)).toEqual(["none", "low", "medium", "high"]);
    });

    it(`reasons through reasoning_effort, not a native field, on ${id}`, () => {
      const caps = getCapabilitiesForModel("clinepass", id);
      expect(caps.reasoning).toBe(true);
      expect(caps.thinkingFormat).toBe("openai");
    });

    it(`keeps the multimodal capabilities the pattern supplied on ${id}`, () => {
      // A provider entry replaces the pattern caps rather than merging over
      // them, so dropping one here would silently revert it to the floor.
      const caps = getCapabilitiesForModel("clinepass", id);
      expect(caps.vision).toBe(true);
      expect(caps.audioInput).toBe(true);
      expect(caps.videoInput).toBe(true);
      expect(caps.contextWindow).toBe(1048576);
      expect(caps.maxOutput).toBe(131072);
    });
  }

  it("leaves MiMo served by another provider alone", () => {
    // The wire elsewhere may reject reasoning_effort, so the grant is scoped.
    expect(getCapabilitiesForModel("openrouter", "mimo-v2.5").reasoning).toBe(false);
    expect(getThinkingLevels("openrouter", "mimo-v2.5")).toBeNull();
  });

  it("leaves the other ClinePass models on their existing levels", () => {
    expect(getThinkingLevels("clinepass", "cline-pass/deepseek-v4-pro")).toEqual(["none", "high"]);
  });
});
