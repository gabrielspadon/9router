import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  getCapabilitiesForModel,
  setModelCapabilityOverrides,
} from "open-sse/providers/capabilities.js";
import { buildModelCapabilityOverrides } from "@/lib/modelCapabilityOverrides";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const route = read("../../src/app/api/models/custom/route.js");
const modal = read("../../src/app/(dashboard)/dashboard/providers/[id]/AddCustomModelModal.js");
const page = read("../../src/app/(dashboard)/dashboard/providers/[id]/page.js");

afterEach(() => setModelCapabilityOverrides({}));

// The report is of max_input_tokens / max_output_tokens being "silently
// dropped": no error, no override, nothing to say why. Two causes, both real —
// the route only read the camelCase spelling, and the dashboard had no field to
// set either one (#1294).
describe("custom model token limits can be set and take effect (#1294)", () => {
  it("the route accepts the snake_case spelling", () => {
    expect(route).toContain('"maxInputTokens" in body ? body.maxInputTokens : body?.max_input_tokens');
    expect(route).toContain('"maxOutputTokens" in body ? body.maxOutputTokens : body?.max_output_tokens');
  });

  it("the alias keys on PRESENCE, so an explicit null still fails validation", () => {
    // With `??` an explicit null fell through to the absent alias and left as
    // undefined, skipping the guard entirely — a permissive shift that the
    // existing provider-cleanup test caught. The alias is a spelling fallback,
    // never a way past validation.
    expect(route).not.toContain("body.maxInputTokens ?? body.max_input_tokens");
    const guard = route.indexOf("must be a positive integer");
    const alias = route.indexOf("body.max_input_tokens");
    expect(alias).toBeLessThan(guard);
  });

  it("the modal offers both fields and sends nothing when they are blank", () => {
    expect(modal).toContain('id="custom-model-max-input"');
    expect(modal).toContain('id="custom-model-max-output"');
    // Blank is "no override", not zero: the API rejects a non-positive value.
    expect(modal).toContain("const toPositiveInt = (raw) =>");
    expect(modal).toContain("Number.isInteger(n) && n > 0 ? n : undefined");
  });

  it("the page forwards them only when set", () => {
    expect(page).toContain("...(caps?.maxInputTokens ? { maxInputTokens: caps.maxInputTokens } : {})");
    expect(page).toContain("...(caps?.maxOutputTokens ? { maxOutputTokens: caps.maxOutputTokens } : {})");
  });

  it("a stored limit reaches the resolver", () => {
    // The end of the chain: without #1904's reader these were write-only.
    setModelCapabilityOverrides(
      buildModelCapabilityOverrides([
        { providerAlias: "kr", id: "acme-passthrough", maxInputTokens: 1000000, maxOutputTokens: 8192 },
      ])
    );
    const caps = getCapabilitiesForModel("kr", "kr/acme-passthrough");
    expect(caps.contextWindow).toBe(1000000);
    expect(caps.maxOutput).toBe(8192);
  });

  it("an unknown passthrough model without an override keeps the default", () => {
    // The report's third complaint: kr/* falls back to a fixed window. That
    // fallback is correct as a default; what was missing is the way to override.
    expect(getCapabilitiesForModel("kr", "kr/acme-passthrough").contextWindow).toBeGreaterThan(0);
  });
});
