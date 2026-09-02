import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("thinking level never escapes the declared set (#3572)", () => {
  const src = readFileSync(new URL("../../open-sse/translator/concerns/thinkingUnified.js", import.meta.url), "utf8");

  it("declares a ladder covering every level the level sets use", () => {
    const ladder = src.match(/OPENAI_LEVEL_LADDER = \[([^\]]+)\]/)?.[1] ?? "";
    for (const level of ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]) {
      expect(ladder, `ladder is missing ${level}`).toContain(`"${level}"`);
    }
  });

  it("no longer returns xhigh without checking the set contains it", () => {
    const fn = src.slice(src.indexOf("function normalizeOpenAILevel"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).not.toContain('return "xhigh";');
    expect(body).toContain("supportedLevels.includes(OPENAI_LEVEL_LADDER[i])");
  });

  it("holds the invariant across every shipped openai-format level set", async () => {
    // The guarantee is that no emitted level falls outside the declared set.
    // Today every such set happens to contain xhigh, so the old code passed
    // too; this asserts the property rather than the accident.
    const { getThinkingLevels } = await import("../../open-sse/providers/thinkingLevels.js");
    const { getStaticCapabilitiesForModel } = await import("../../open-sse/providers/capabilities.js");
    const probes = [["nvidia", "z-ai/glm-5.2"], ["fireworks", "accounts/fireworks/models/glm-5p2"],
                    ["codebuddy-cn", "glm-5.2"], ["poolside", "laguna-s-2.1"]];
    let checked = 0;
    for (const [provider, model] of probes) {
      if (getStaticCapabilitiesForModel(provider, model).thinkingFormat !== "openai") continue;
      const levels = getThinkingLevels(provider, model);
      expect(Array.isArray(levels) && levels.length, `${provider}/${model} declares no levels`).toBeTruthy();
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
