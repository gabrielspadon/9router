import { describe, expect, it } from "vitest";
import { getStaticCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getProviderModels } from "../../open-sse/config/providerModels.js";

// NVIDIA NIM is an OpenAI-compatible endpoint. A model whose capabilities carry a
// vendor-native thinking format (kimi, step, zai, minimax) makes the translator
// emit that vendor's native reasoning field, which NIM rejects.
describe("NVIDIA NIM reasoning models use the openai thinking format (#2268)", () => {
  const models = getProviderModels("nvidia").map((m) => m.id ?? m);

  it("lists models to check", () => {
    expect(models.length).toBeGreaterThan(0);
  });

  it("never emits a vendor-native thinking format on an OpenAI-compatible endpoint", () => {
    const offenders = models
      .map((id) => [id, getStaticCapabilitiesForModel("nvidia", id)])
      .filter(([, c]) => c.reasoning && c.thinkingFormat && c.thinkingFormat !== "openai")
      .map(([id, c]) => `${id} -> ${c.thinkingFormat}`);
    expect(offenders).toEqual([]);
  });

  it("keeps every non-default capability the pattern would have supplied", () => {
    // A provider row REPLACES the pattern caps, so overriding thinkingFormat can
    // silently drop vision or the context window. Compare against the same model
    // resolved with no provider override.
    for (const id of models) {
      const withProvider = getStaticCapabilitiesForModel("nvidia", id);
      const generic = getStaticCapabilitiesForModel("__no_provider__", id);
      for (const key of ["vision", "videoInput", "tools", "reasoning", "contextWindow", "maxOutput"]) {
        if (generic[key] === true || (typeof generic[key] === "number" && generic[key] > 0)) {
          expect(withProvider[key], `${id}.${key} regressed under the nvidia override`).toBeTruthy();
        }
      }
    }
  });
});
