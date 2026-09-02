import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  getCapabilitiesForModel,
  setModelCapabilityOverrides,
  setContextWindowOverrides,
} from "open-sse/providers/capabilities.js";
import { buildModelCapabilityOverrides } from "@/lib/modelCapabilityOverrides";

const route = readFileSync(new URL("../../src/app/api/models/custom/route.js", import.meta.url), "utf8");

afterEach(() => {
  setModelCapabilityOverrides({});
  setContextWindowOverrides({});
});

// A custom model is added by id alone. An id the capabilities tables do not
// recognise falls through to DEFAULT_CAPABILITIES, which says vision:false, so a
// hand-added image model had every image dropped and no way to declare otherwise
// (#1904). The store already carried maxInputTokens and maxOutputTokens per
// custom model and nothing read them; this is the read side for all three.
describe("custom models can declare capabilities (#1904)", () => {
  const MODEL = "cf/acme-internal-7b";

  it("an unrecognised id is text-only without an override", () => {
    expect(getCapabilitiesForModel("cf", MODEL).vision).toBe(false);
  });

  it("the declared vision flag reaches the resolver", () => {
    setModelCapabilityOverrides(
      buildModelCapabilityOverrides([{ providerAlias: "cf", id: "acme-internal-7b", vision: true }])
    );
    expect(getCapabilitiesForModel("cf", MODEL).vision).toBe(true);
  });

  it("the override is provider-scoped and does not leak to another provider serving the same id", () => {
    setModelCapabilityOverrides(
      buildModelCapabilityOverrides([{ providerAlias: "cf", id: "acme-internal-7b", vision: true }])
    );
    expect(getCapabilitiesForModel("nvidia", "nvidia/acme-internal-7b").vision).toBe(false);
  });

  it("maxInputTokens and maxOutputTokens finally have a reader", () => {
    setModelCapabilityOverrides(
      buildModelCapabilityOverrides([
        { providerAlias: "cf", id: "acme-internal-7b", maxInputTokens: 999000, maxOutputTokens: 4096 },
      ])
    );
    const caps = getCapabilitiesForModel("cf", MODEL);
    expect(caps.contextWindow).toBe(999000);
    expect(caps.maxOutput).toBe(4096);
  });

  it("a custom model declaring nothing produces no map entry", () => {
    expect(buildModelCapabilityOverrides([{ providerAlias: "cf", id: "plain" }]).size).toBe(0);
  });

  it("an explicit model-context edit still wins on contextWindow", () => {
    // The two override planes meet only on contextWindow. The dedicated
    // dashboard surface is applied last on purpose.
    setModelCapabilityOverrides(
      buildModelCapabilityOverrides([{ providerAlias: "cf", id: "acme-internal-7b", maxInputTokens: 1000 }])
    );
    setContextWindowOverrides({ "acme-internal-7b": 32000 });
    expect(getCapabilitiesForModel("cf", MODEL).contextWindow).toBe(32000);
  });

  it("an existing recognised model is untouched when no override is set", () => {
    const caps = getCapabilitiesForModel("claude", "claude-sonnet-4.5");
    expect(caps.vision).toBe(true);
  });

  it("the write path validates the flag and re-publishes the map", () => {
    expect(route).toContain('typeof vision !== "boolean"');
    // Every write path must refresh, or a removed model keeps its override
    // until the next boot: the batch import, the single add, and the delete.
    expect((route.match(/await refreshModelCapabilityOverrides\(\)/g) || []).length).toBe(3);
  });
});
