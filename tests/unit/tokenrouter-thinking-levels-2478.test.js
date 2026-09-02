import { describe, it, expect } from "vitest";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import { applyThinking } from "open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "open-sse/translator/formats.js";

// #2478 — the model-selection level picker is driven by getThinkingLevels.
// TokenRouter declares thinkingFormat "tokenrouter" at provider level
// (open-sse/providers/registry/tokenrouter.js:25) and its applyFormat branch
// documents the enum low|medium|high|xhigh|max, but FORMAT_LEVELS had no
// tokenrouter key, so every TokenRouter model fell back to the generic
// none/low/medium/high ladder.
describe("TokenRouter thinking levels (#2478)", () => {
  const MODELS = [
    "anthropic/claude-sonnet-5",
    "anthropic/claude-opus-4.8",
    "deepseek/deepseek-v4-pro",
  ];

  it("offers TokenRouter's own reasoning_effort enum", () => {
    for (const model of MODELS) {
      expect(getThinkingLevels("tokenrouter", model)).toEqual([
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ]);
    }
  });

  it("does not offer a level TokenRouter rejects", () => {
    for (const model of MODELS) {
      const levels = getThinkingLevels("tokenrouter", model);
      expect(levels).not.toContain("none");
      expect(levels).not.toContain("auto");
      expect(levels).not.toContain("minimal");
    }
  });

  it("passes the top of that ladder through unclamped", () => {
    const body = applyThinking(
      FORMATS.OPENAI,
      "anthropic/claude-sonnet-5(max)",
      { messages: [] },
      "tokenrouter",
    );
    expect(body.reasoning_effort).toBe("max");
  });

  it("omits the field for none/auto rather than sending a rejected value", () => {
    for (const suffix of ["(none)", "(auto)"]) {
      const body = applyThinking(
        FORMATS.OPENAI,
        `anthropic/claude-sonnet-5${suffix}`,
        { messages: [] },
        "tokenrouter",
      );
      expect(body.reasoning_effort).toBeUndefined();
      expect(body.thinking).toBeUndefined();
    }
  });

  it("is provider-scoped: the same model id elsewhere keeps its own ladder", () => {
    const anthropic = getThinkingLevels("anthropic", "claude-sonnet-5");
    expect(anthropic).not.toEqual(getThinkingLevels("tokenrouter", "anthropic/claude-sonnet-5"));
    expect(anthropic).toContain("none");
  });
});
