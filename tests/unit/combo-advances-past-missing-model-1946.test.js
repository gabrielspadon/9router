import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { checkFallbackError } from "open-sse/services/accountFallback.js";

const combo = readFileSync(new URL("../../open-sse/services/combo.js", import.meta.url), "utf8");

// The reporter's combo did not fall back: "I feel it should have fell back to
// the working claude or local model, but I was stuck with errors" (#1946). A
// member whose model the provider does not serve answers 404 model_not_found,
// and the combo aborted on it instead of trying the next one.
describe("a combo advances past a model the provider does not serve (#1946)", () => {
  it("the account-level predicate deliberately does NOT fall back on it", () => {
    // This is the premise, and it is correct for its own purpose: a user-side
    // model name must not lock the account (#2032). The combo needed its own
    // answer rather than a change here.
    const verdict = checkFallbackError(404, '{"error":{"code":"model_not_found"}}');
    expect(verdict.shouldFallback).toBe(false);
  });

  it("a bare 404 with no such body still falls back at account level", () => {
    // Unchanged: that one is an endpoint problem, not a model name.
    expect(checkFallbackError(404, "Not Found").shouldFallback).toBe(true);
  });

  it("the combo now treats it as a model limitation", () => {
    expect(combo).toContain('lowerErr.includes("model_not_found")');
    expect(combo).toContain('lowerErr.includes("model not found")');
  });

  it("the generic phrasing is deliberately not matched", () => {
    // "does not exist" would turn a real account failure into a silent walk
    // through every member; #2032 refused it for the same reason.
    expect(combo).not.toContain('lowerErr.includes("does not exist")');
  });

  it("it joins the existing escape hatch rather than a second branch", () => {
    const i = combo.indexOf("const isContextOrModelLimitation");
    const block = combo.slice(i, i + 600);
    expect(block).toContain("model_not_found");
    expect(block).toContain("context_length");
    expect(combo).toContain("if (!shouldFallback && !isContextOrModelLimitation) {");
  });

  it("the pre-existing limitation matches still work", () => {
    for (const phrase of ["max_tokens", "context length", "prompt is too long", "not supported"]) {
      expect(combo).toContain(`lowerErr.includes("${phrase}")`);
    }
  });
});
