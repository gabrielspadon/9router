import { describe, it, expect, afterEach } from "vitest";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import { applyThinking, parseSuffix } from "open-sse/translator/concerns/thinkingUnified.js";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { FORMATS } from "open-sse/translator/formats.js";

// #2440 "No option to disable reasoning each model?" — evidence that the
// per-model disable already exists in three composable forms. This test is the
// contract for them, so a later refactor cannot quietly drop one.
describe("per-model reasoning disable (#2440)", () => {
  afterEach(() => {
    delete process.env.MODEL_CAPABILITY_OVERRIDES;
  });

  it("parses the per-model (none)/(off) suffix into a disable intent", () => {
    for (const raw of ["gpt-5.5(none)", "gpt-5.5(off)", "gpt-5.5(NONE)"]) {
      expect(parseSuffix(raw)).toEqual({
        cleanModel: "gpt-5.5",
        override: { mode: "none" },
      });
    }
  });

  it("turns that suffix into the provider's own disable field", () => {
    const openai = applyThinking(FORMATS.OPENAI, "gpt-5.5(none)", { messages: [] }, "openai");
    expect(openai.reasoning_effort).toBe("none");

    const claude = applyThinking(FORMATS.CLAUDE, "claude-sonnet-4.5(none)", { messages: [] }, "anthropic");
    expect(claude.thinking).toEqual({ type: "disabled" });

    const gemini = applyThinking(FORMATS.GEMINI, "gemini-2.5-pro(none)", { messages: [] }, "gemini");
    expect(gemini.generationConfig.thinkingConfig).toEqual({
      thinkingBudget: 0,
      includeThoughts: false,
    });
  });

  it("wins over a thinking intent the client put in the body", () => {
    const body = applyThinking(
      FORMATS.OPENAI,
      "gpt-5.5(none)",
      { messages: [], reasoning_effort: "high" },
      "openai",
    );
    expect(body.reasoning_effort).toBe("none");
  });

  it("advertises the level only where the model can actually disable", () => {
    expect(getThinkingLevels("openai", "gpt-5.5")).toContain("none");
    expect(getCapabilitiesForModel("codebuddy-cn", "glm-5.2").thinkingCanDisable).toBe(false);
    expect(getThinkingLevels("codebuddy-cn", "glm-5.2")).not.toContain("none");
  });

  it("clamps to minimal instead of disabling when the model cannot turn it off", () => {
    const body = applyThinking(FORMATS.OPENAI, "glm-5.2(none)", { messages: [] }, "codebuddy-cn");
    expect(body.reasoning_effort).toBe("minimal");
  });

  it("lets MODEL_CAPABILITY_OVERRIDES restore the disable for one model", () => {
    process.env.MODEL_CAPABILITY_OVERRIDES = JSON.stringify({
      "codebuddy-cn/glm-5.2": { thinkingCanDisable: true },
    });
    expect(getThinkingLevels("codebuddy-cn", "glm-5.2")).toContain("none");
    const body = applyThinking(FORMATS.OPENAI, "glm-5.2(none)", { messages: [] }, "codebuddy-cn");
    expect(body.reasoning_effort).toBe("none");

    // Scoped to the model it names — its sibling on the same provider is untouched.
    expect(getThinkingLevels("codebuddy-cn", "glm-5.1")).not.toContain("none");
  });
});
