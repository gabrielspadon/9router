import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS, getModelUpstreamId } from "open-sse/config/providerModels.js";
import { getStaticCapabilitiesForModel } from "open-sse/providers/capabilities.js";

// Command Code's catalogue stopped at GLM 5.1 (#2334).
describe("commandcode lists GLM 5.2 (#2334)", () => {
  it("declares the id in the vendor's own naming", () => {
    const ids = PROVIDER_MODELS.commandcode.map((m) => m.id);
    expect(ids).toContain("zai-org/GLM-5.2");
    // Same shape as the siblings, so it addresses the upstream verbatim.
    expect(getModelUpstreamId("commandcode", "zai-org/GLM-5.2")).toBe("zai-org/GLM-5.2");
  });

  it("inherits GLM capabilities from the pattern table, not a hand-written entry", () => {
    const caps = getStaticCapabilitiesForModel("commandcode", "zai-org/GLM-5.2");
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("zai");
  });

  it("keeps the existing catalogue and its default model", () => {
    const ids = PROVIDER_MODELS.commandcode.map((m) => m.id);
    expect(ids).toContain("zai-org/GLM-5.1");
    expect(ids).toContain("zai-org/GLM-5");
    expect(ids[0]).toBe("deepseek/deepseek-v4-pro");
  });
});
