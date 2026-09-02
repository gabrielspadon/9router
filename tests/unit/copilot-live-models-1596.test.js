import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getProviderModels } from "../../open-sse/config/providerModels.js";

const registry = readFileSync(new URL("../../open-sse/providers/registry/github.js", import.meta.url), "utf8");
const modelsRoute = readFileSync(new URL("../../src/app/api/v1/models/route.js", import.meta.url), "utf8");

// The static github model list is deliberately behind Copilot's live catalog.
// Adding a claude-* row is not merely unnecessary, it is harmful: routing to
// Copilot's Anthropic-native shim is decided by model NAME at request time, and
// a static targetFormat entry would double-translate.
describe("Copilot claude models come from the live catalog (#1596)", () => {
  it("resolves the static list by alias, not by id", () => {
    // Worth pinning: getProviderModels("github") returns nothing, which reads
    // like a missing catalog until you know the lookup key is the alias.
    expect(getProviderModels("github")).toHaveLength(0);
    expect(getProviderModels("gh").length).toBeGreaterThan(0);
  });

  it("still ships the claude models it does list statically", () => {
    const ids = getProviderModels("gh").map((m) => m.id ?? m);
    expect(ids).toContain("claude-opus-4.7");
    expect(ids).toContain("claude-sonnet-4.6");
  });

  it("discovers the rest live, which is how newer models arrive", () => {
    expect(modelsRoute).toContain("resolveCopilotModels");
    expect(modelsRoute).toContain('open-sse/services/copilotModels.js');
  });

  it("records why the static list is deliberately incomplete", () => {
    // If this comment goes, the next person adds the row the comment warns about.
    expect(registry).toMatch(/live model catalog/i);
    expect(registry).toMatch(/double-translating/);
  });
});
