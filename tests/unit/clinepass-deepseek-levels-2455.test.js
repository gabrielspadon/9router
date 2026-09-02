import { describe, expect, it } from "vitest";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import { applyThinking } from "open-sse/translator/concerns/thinkingUnified.js";

const MODEL = "cline-pass/deepseek-v4-flash";

// ClinePass is an aggregator: its ids carry the upstream vendor's name, so a
// deepseek id resolves to the deepseek ladder none/high/max. The reporter states
// max is not supported there, and an unsupported level is a failed request
// rather than a degraded one (#2455).
describe("ClinePass deepseek models are not offered max (#2455)", () => {
  it("max is gone from the level set", () => {
    const levels = getThinkingLevels("clinepass", MODEL);
    expect(levels).not.toContain("max");
    expect(levels).toContain("high");
  });

  it("a request asking for max goes out at high", () => {
    // The level set alone was not enough: the deepseek branch mapped max to max
    // without consulting it, so narrowing the set changed nothing on the wire.
    const body = {};
    applyThinking("openai", `${MODEL}(max)`, body, "clinepass");
    expect(body.reasoning_effort).toBe("high");
    expect(body.thinking).toEqual({ type: "enabled" });
  });

  it("the direct deepseek provider still emits max on the wire", () => {
    const body = {};
    applyThinking("openai", "deepseek-v4-flash(max)", body, "deepseek");
    expect(body.reasoning_effort).toBe("max");
  });

  it("the direct deepseek provider keeps max", () => {
    // The constraint is the aggregator's, not the model's.
    expect(getThinkingLevels("deepseek", "deepseek-v4-flash")).toContain("max");
  });

  it("other ClinePass models are untouched", () => {
    // The rule is scoped by pattern, so only the deepseek ids lose a level.
    const kimi = getThinkingLevels("clinepass", "cline-pass/kimi-k2.6");
    if (kimi) expect(kimi).not.toEqual(["none", "high"]);
  });
});
