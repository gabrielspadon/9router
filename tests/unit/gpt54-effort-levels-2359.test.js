import { describe, expect, it } from "vitest";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { getStaticCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getProviderModels } from "../../open-sse/config/providerModels.js";

// The reporter asked for low/medium/high/xhigh on GPT 5.4 and 5.5. `cx` is the
// alias of the CODEX provider, not cursor (whose alias is `cu` and which ships
// no gpt-5.4/5.5 at all), so every lookup here names codex: passing "cursor"
// resolves by pattern instead of through the provider block and would pass for
// the wrong reason. The levels
// are declared and the model(level) form resolves, so the capability is present;
// what is absent is a literal cx/gpt-5.4-low row in the model list, which is a
// listing preference rather than a missing capability.
const MODELS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"];

describe("GPT 5.4 and 5.5 reach every effort level (#2359)", () => {
  it("ships the models", () => {
    const ids = getProviderModels("cx").map((m) => m.id ?? m);
    for (const m of MODELS) expect(ids, `cx is missing ${m}`).toContain(m);
  });

  it("declares each requested level", () => {
    for (const m of MODELS) {
      const levels = getThinkingLevels("codex", m);
      for (const lvl of ["low", "medium", "high", "xhigh"]) {
        expect(levels, `${m} does not offer ${lvl}`).toContain(lvl);
      }
    }
  });

  it("resolves the model(level) form to the same capable model", () => {
    for (const m of MODELS) {
      const base = getStaticCapabilitiesForModel("codex", m);
      for (const lvl of ["low", "high", "xhigh"]) {
        const withLevel = getStaticCapabilitiesForModel("codex", `${m}(${lvl})`);
        expect(withLevel.reasoning, `${m}(${lvl}) lost reasoning`).toBe(true);
        expect(withLevel.contextWindow).toBe(base.contextWindow);
        expect(withLevel.thinkingFormat).toBe(base.thinkingFormat);
      }
    }
  });

  it("uses the openai effort format, which is what carries the level", () => {
    for (const m of MODELS) {
      expect(getStaticCapabilitiesForModel("codex", m).thinkingFormat).toBe("openai");
    }
  });
});
