import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { stripContextSuffix, looksLikeClaudeWrappedModel } from "../../src/lib/claudeCompat.js";

const chat = readFileSync(new URL("../../src/sse/handlers/chat.js", import.meta.url), "utf8");

// The [1m] suffix is tokenproxy's own annotation on its rewritten /v1/models ids,
// and nothing upstream accepts it. Stripping it used to sit behind the
// claude-compat toggle, so turning compat off re-exposed a 404 that reads as a
// missing model — a client caches the model list and keeps echoing an id minted
// while compat was on.
describe("the [1m] context suffix never reaches an upstream (#2531)", () => {
  it("strips the suffix", () => {
    expect(stripContextSuffix("cc/claude-opus-4.7[1m]")).toBe("cc/claude-opus-4.7");
    expect(stripContextSuffix("claude-bai/deepseek-v4-flash[1m]")).toBe("claude-bai/deepseek-v4-flash");
  });

  it("matches case-insensitively and only at the end", () => {
    expect(stripContextSuffix("model[1M]")).toBe("model");
    // A marker in the middle is part of the name, not the annotation.
    expect(stripContextSuffix("model[1m]-x")).toBe("model[1m]-x");
  });

  it("leaves an ordinary id alone", () => {
    for (const id of ["gpt-5.6-sol", "kr/claude-haiku-4.5", "z-ai/glm-5.2"]) {
      expect(stripContextSuffix(id)).toBe(id);
    }
  });

  it("never returns an empty id", () => {
    expect(stripContextSuffix("[1m]")).toBe("[1m]");
  });

  it("survives a non-string", () => {
    for (const v of [null, undefined, 7, {}]) expect(stripContextSuffix(v)).toBe(v);
  });

  it("runs in chat.js before, and outside, the compat-gated block", () => {
    const strip = chat.indexOf("const unsuffixed = stripContextSuffix(modelStr);");
    const gate = chat.indexOf('process.env.DISABLE_CLAUDE_COMPAT !== "true"');
    expect(strip).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(strip);
    // The strip must not itself be inside a compat.enabled branch.
    const between = chat.slice(strip, gate);
    expect(between).not.toContain("compat.enabled");
  });

  it("still recognises a wrapped model for the gated rewrite", () => {
    expect(looksLikeClaudeWrappedModel("claude-bai/x[1m]")).toBe(true);
  });
});
