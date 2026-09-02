import { describe, expect, it } from "vitest";
import { augmentModelsWithCapacityAdapter } from "../../open-sse/services/capacityAdapter.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// #1419 asks for an automatic image-to-text fallback: route a request carrying
// an image to a vision-capable model when the user's target model cannot read
// images. That is already the capacityAdapter mechanism (services/capacityAdapter.js,
// not this lane) once a target model's capability declaration is accurate — which
// IS this lane's job (providers/capabilities.js). Verifying the declaration lines
// up with the adapter's default pool closes the loop without adding a second,
// competing OCR/caption pipeline the fork does not want on top of it.
describe("capacity adapter vision fallback declarations (#1419)", () => {
  it("declares the adapter's default vision fallback model as vision-capable", () => {
    // oc/mimo-v2.5-free is capacityAdapter.js's DEFAULT_FALLBACK_MODEL; the "oc"
    // (opencode) provider fetches its catalog dynamically (passthroughModels),
    // so the capability comes from the canonical MODEL_CAPABILITIES entry, not
    // a provider-specific override.
    expect(getCapabilitiesForModel("oc", "mimo-v2.5-free").vision).toBe(true);
  });

  it("prepends the vision-capable fallback ahead of a non-vision target when enabled", () => {
    const settings = { capacityAdapter: { vision: { enabled: true, models: [] } } };
    const out = augmentModelsWithCapacityAdapter(["ocg/glm-5.2"], ["vision"], settings);
    expect(out).toEqual(["oc/mimo-v2.5-free", "ocg/glm-5.2"]);
  });

  it("leaves the model list untouched when a member already covers vision", () => {
    const settings = { capacityAdapter: { vision: { enabled: true, models: [] } } };
    const out = augmentModelsWithCapacityAdapter(["oc/mimo-v2.5-free", "ocg/glm-5.2"], ["vision"], settings);
    expect(out).toEqual(["oc/mimo-v2.5-free", "ocg/glm-5.2"]);
  });
});
