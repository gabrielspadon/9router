import { describe, expect, it } from "vitest";
import { getStaticCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import registry from "../../open-sse/providers/registry/xiaomi-tokenplan.js";

// Issue #3304. The Capacity Adapter only reroutes when the requested model
// LACKS a capability, so a model that falsely advertises vision is sent
// upstream as-is and 404s, even with a working vision adapter configured. The
// provider ships text-only models under ids that the pattern table reads as
// multimodal: "*mimo*v2.5*" grants vision, audioInput and videoInput, and
// "*mimo*" grants vision. Only three chat ids were overridden, so the rest —
// including every TTS id — fell through.

const ids = (registry.models || []).map((m) => m.id);

describe("xiaomi-tokenplan TTS models never claim vision (#3304)", () => {
  const ttsIds = ids.filter((i) => i.includes("tts"));

  it("ships TTS models to check", () => {
    expect(ttsIds.length).toBeGreaterThanOrEqual(4);
  });

  for (const alias of ["xiaomi-tokenplan", "xmtp"]) {
    it(`no ${alias} TTS model advertises vision or video`, () => {
      const offenders = ttsIds.filter((id) => {
        const caps = getStaticCapabilitiesForModel(alias, id);
        return caps.vision || caps.videoInput;
      });
      expect(offenders).toEqual([]);
    });
  }

  it("gives the TTS models audio output instead", () => {
    for (const id of ttsIds) {
      expect(getStaticCapabilitiesForModel("xiaomi-tokenplan", id).audioOutput, id).toBe(true);
    }
  });

  it("leaves the genuinely multimodal omni model alone", () => {
    // #3304 asserts the provider has no vision models at all. That is
    // overbroad, and a sibling test pins omni as multimodal on purpose, so the
    // fix is scoped to TTS rather than applied provider-wide.
    const caps = getStaticCapabilitiesForModel("xmtp", "mimo-v2-omni");
    expect(caps.vision).toBe(true);
    expect(caps.audioInput).toBe(true);
  });
});
