import { afterEach, describe, expect, it } from "vitest";
import {
  getCapabilitiesForModel,
  setModelCapabilityOverrides,
  setContextWindowOverrides,
} from "open-sse/providers/capabilities.js";

// The capability tables are a master list that only a release can change, so a
// natively-multimodal model the list has not caught up with is served as
// text-only for months, and a stealth model is gone before a PR merges (#3455).
// The engine already had a per-model override map, but the app only ever fed it
// from the CUSTOM-model store — bring-your-own endpoints — so an existing
// provider's model could not be reshaped at all, which is what drove #3472's
// reporter to hand-patch the installed package on every update.
// MODEL_CAPABILITY_OVERRIDES is the user-editable source for that same map.
const setEnv = (value) => {
  if (value === null) delete process.env.MODEL_CAPABILITY_OVERRIDES;
  else process.env.MODEL_CAPABILITY_OVERRIDES = value;
};

afterEach(() => {
  setEnv(null);
  setModelCapabilityOverrides({});
  setContextWindowOverrides({});
});

describe("user-editable model capability overrides (#3455, #3472)", () => {
  it("leaves the catalog alone when the variable is unset", () => {
    const caps = getCapabilitiesForModel("openrouter", "stealth/ox-alpha");
    expect(caps.vision).toBe(false);
    expect(caps.reasoning).toBe(true);
    expect(caps.contextWindow).toBe(1048576);
  });

  it("reshapes an existing provider's model, vendor prefix and all", () => {
    // The key is spelled the way the store spells it, provider + the id with its
    // vendor prefix intact. Before this it resolved to "openrouter/ox-alpha" and
    // matched nothing.
    setEnv(JSON.stringify({ "openrouter/stealth/ox-alpha": { vision: true } }));
    const caps = getCapabilitiesForModel("openrouter", "stealth/ox-alpha");
    expect(caps.vision).toBe(true);
    // Untouched flags survive: the override layers over the catalog row, it does
    // not replace it the way a PROVIDER_CAPABILITIES entry does.
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingCanDisable).toBe(false);
  });

  it("does not leak onto another provider serving the same id", () => {
    setEnv(JSON.stringify({ "openrouter/stealth/ox-alpha": { vision: true } }));
    expect(getCapabilitiesForModel("opencode", "stealth/ox-alpha").vision).toBe(false);
  });

  // The fixture ids deliberately carry no modality word: visionPatterns.js
  // grants vision from the id alone at the floor layer, which would make every
  // vision assertion below pass without the override under test doing anything.
  it("accepts a bare model id, which applies wherever it is served", () => {
    setEnv(JSON.stringify({ "acme-neo-1": { vision: true, contextWindow: 999000 } }));
    expect(getCapabilitiesForModel("cf", "acme-neo-1").vision).toBe(true);
    expect(getCapabilitiesForModel("nvidia", "vendor/acme-neo-1").contextWindow).toBe(999000);
  });

  it("accepts a glob, so a whole cloaked family can be corrected at once", () => {
    setEnv(JSON.stringify({ "openrouter/stealth/*": { audioInput: true } }));
    expect(getCapabilitiesForModel("openrouter", "stealth/ox-alpha").audioInput).toBe(true);
    expect(getCapabilitiesForModel("openrouter", "stealth/other-model").audioInput).toBe(true);
  });

  it("yields to a per-model entry injected by the app", () => {
    // Both planes are the user's. The dashboard/custom-model entry is the more
    // specific of the two, so it wins where they name the same flag.
    setEnv(JSON.stringify({ "cf/acme-neo-1": { vision: true, maxOutput: 8192 } }));
    setModelCapabilityOverrides({ "cf/acme-neo-1": { vision: false } });
    const caps = getCapabilitiesForModel("cf", "acme-neo-1");
    expect(caps.vision).toBe(false);
    // A flag only the environment declares still applies.
    expect(caps.maxOutput).toBe(8192);
  });

  it("fails open on a malformed value rather than taking the gateway down", () => {
    setEnv("{not json");
    expect(() => getCapabilitiesForModel("openrouter", "stealth/ox-alpha")).not.toThrow();
    expect(getCapabilitiesForModel("openrouter", "stealth/ox-alpha").vision).toBe(false);
  });

  it("ignores an entry whose value is not a capability object", () => {
    setEnv(JSON.stringify({ "cf/acme-neo-1": "vision", "cf/acme-neo-2": { vision: true } }));
    expect(getCapabilitiesForModel("cf", "acme-neo-1").vision).toBe(false);
    expect(getCapabilitiesForModel("cf", "acme-neo-2").vision).toBe(true);
  });

  it("still yields contextWindow to the dedicated model-context surface", () => {
    setEnv(JSON.stringify({ "cf/acme-neo-1": { contextWindow: 1000 } }));
    setContextWindowOverrides({ "acme-neo-1": 32000 });
    expect(getCapabilitiesForModel("cf", "acme-neo-1").contextWindow).toBe(32000);
  });

  it("resolves an injected key whose model id carries a slash", () => {
    // Same lookup bug, reached through the custom-model store: it keys entries
    // `${providerAlias}/${id}` and an id with a slash never matched.
    setModelCapabilityOverrides({ "cf/vendor/acme-neo-1": { vision: true } });
    expect(getCapabilitiesForModel("cf", "vendor/acme-neo-1").vision).toBe(true);
  });
});
