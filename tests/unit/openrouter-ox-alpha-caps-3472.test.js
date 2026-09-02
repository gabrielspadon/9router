import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

// stealth/ox-alpha on OpenRouter had no catalog entry, so it fell through to the
// defaults — reasoning:false, contextWindow 200000 — and the request came back
// HTTP 200 with a body of pure whitespace, because the pipeline was never told
// to expect reasoning output. Direct-to-OpenRouter with the same body works,
// which is what rules the upstream out (#3472).
const caps = () => getCapabilitiesForModel("openrouter", "stealth/ox-alpha");

describe("openrouter stealth/ox-alpha resolves its own capabilities (#3472)", () => {
  it("is a reasoning model, which is the part that produced the blank body", () => {
    expect(caps().reasoning).toBe(true);
  });

  it("uses the OpenAI thinking wire, since OpenRouter is OpenAI-compatible", () => {
    // The opencode-hosted sibling ox-alpha-free uses the opencode enum; the
    // route decides the format here, not the model family.
    expect(caps().thinkingFormat).toBe("openai");
    expect(getCapabilitiesForModel("opencode-go", "ox-alpha-free").thinkingFormat).toBe("opencode");
  });

  it("cannot disable thinking — the Stealth endpoint rejects that", () => {
    expect(caps().thinkingCanDisable).toBe(false);
  });

  it("carries its own window and output ceiling rather than the 200k default", () => {
    expect(caps().contextWindow).toBe(1048576);
    expect(caps().maxOutput).toBe(131072);
  });

  it("declares tools and no vision", () => {
    expect(caps().tools).toBe(true);
    expect(caps().vision).toBe(false);
  });

  it("does not leak onto other OpenRouter models", () => {
    // A provider entry replaces pattern caps, so a too-broad key here would
    // quietly re-shape every model on the provider.
    const other = getCapabilitiesForModel("openrouter", "some/ordinary-model");
    expect(other.reasoning).toBe(false);
    expect(other.contextWindow).toBe(200000);
  });

  it("does not leak onto the same model name under a different provider", () => {
    const elsewhere = getCapabilitiesForModel("groq", "stealth/ox-alpha");
    expect(elsewhere.contextWindow).not.toBe(1048576);
  });
});
