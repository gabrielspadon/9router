import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("getCapabilitiesForModel", () => {
  const claudeSonnet5Expected = {
    contextWindow: 1000000,
    maxOutput: 128000,
    thinkingFormat: "claude-adaptive",
    reasoning: true,
    vision: true,
    search: true,
  };

  const kiroGpt56Expected = {
    contextWindow: 272000,
    maxOutput: 128000,
    thinkingFormat: "openai",
    reasoning: true,
    vision: true,
    search: true,
  };

  it("reports Kiro Claude Opus 5 variants as 1M adaptive-thinking models", () => {
    for (const model of [
      "claude-opus-5",
      "anthropic/claude-opus-5",
      "claude-opus-5-thinking",
      "claude-opus-5-agentic",
      "claude-opus-5-thinking-agentic",
    ]) {
      expect(getCapabilitiesForModel("kiro", model)).toMatchObject(claudeSonnet5Expected);
    }
  });

  it("reports Kiro Claude Opus 4.8 as a 1M context model", () => {
    expect(getCapabilitiesForModel("kiro", "claude-opus-4.8").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "anthropic/claude-opus-4.8").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "claude-opus-4-8").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "claude-opus-4.8-thinking").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "claude-opus-4-8-thinking").contextWindow).toBe(1000000);
  });

  it("reports Kiro Claude Sonnet 5 as a 1M adaptive-thinking model", () => {
    expect(getCapabilitiesForModel("kiro", "claude-sonnet-5")).toMatchObject(claudeSonnet5Expected);
    expect(getCapabilitiesForModel("kiro", "anthropic/claude-sonnet-5")).toMatchObject(claudeSonnet5Expected);
    expect(getCapabilitiesForModel("kiro", "claude-sonnet-5-thinking")).toMatchObject(claudeSonnet5Expected);
    expect(getCapabilitiesForModel("kiro", "claude-sonnet-5-agentic")).toMatchObject(claudeSonnet5Expected);
    expect(getCapabilitiesForModel("kiro", "claude-sonnet-5-thinking-agentic")).toMatchObject(claudeSonnet5Expected);
  });

  it("reports Kiro GPT 5.6 models with the Kiro 272k context window", () => {
    expect(getCapabilitiesForModel("kiro", "gpt-5.6-sol")).toMatchObject(kiroGpt56Expected);
    expect(getCapabilitiesForModel("kiro", "openai/gpt-5.6-sol")).toMatchObject(kiroGpt56Expected);
    expect(getCapabilitiesForModel("kiro", "gpt-5.6-terra-thinking")).toMatchObject(kiroGpt56Expected);
    expect(getCapabilitiesForModel("kiro", "gpt-5.6-luna-agentic")).toMatchObject(kiroGpt56Expected);
    expect(getCapabilitiesForModel("kiro", "gpt-5.6-sol-thinking-agentic")).toMatchObject(kiroGpt56Expected);
  });

  it("marks DeepSeek V4 Flash Vision as vision-capable", () => {
    const expected = { vision: true, reasoning: true, thinkingFormat: "deepseek" };
    expect(getCapabilitiesForModel("opencode-go", "deepseek-v4-flash-vision-exp")).toMatchObject(expected);
    expect(getCapabilitiesForModel("commandcode", "deepseek/deepseek-v4-flash-vision-exp")).toMatchObject(expected);
    expect(getCapabilitiesForModel("commandcode", "deepseek-v4-flash-vision-exp")).toMatchObject(expected);
    expect(getCapabilitiesForModel("opencode-go", "deepseek-v4-flash").vision).toBeFalsy();
  });
});

describe("Ox Alpha capability entries (provider-scoped, upstream #3483)", () => {
  const GO_ID = "ox-alpha-free";
  const OX_PAIRS = [
    ["opencode", GO_ID],
    ["oc", GO_ID],
    ["opencode-go", GO_ID],
    ["ocg", GO_ID],
  ];

  it.each(OX_PAIRS)("caps %s/%s report image+reasoning via opencode format", (provider, model) => {
    const caps = getCapabilitiesForModel(provider, model);
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("opencode");
    expect(caps.contextWindow).toBe(1000000);
    expect(caps.maxOutput).toBe(131072);
  });

  it("bare id without a provider keeps default (no vision)", () => {
    expect(getCapabilitiesForModel(null, GO_ID).vision).toBe(false);
  });

  it("mismatched providers do not pick up Ox Alpha caps", () => {
    expect(getCapabilitiesForModel("nvidia", GO_ID).vision).toBe(false);
    expect(getCapabilitiesForModel("openai", GO_ID).thinkingFormat).not.toBe("opencode");
  });

  it("suffix '(max)' resolves to identical caps for all 4 pairs", () => {
    for (const [provider, model] of OX_PAIRS) {
      expect(getCapabilitiesForModel(provider, `${model}(max)`)).toEqual(getCapabilitiesForModel(provider, model));
    }
  });

  it("numeric suffix '(8192)' resolves to identical caps", () => {
    expect(getCapabilitiesForModel("ocg", `${GO_ID}(8192)`)).toEqual(getCapabilitiesForModel("ocg", GO_ID));
  });

  it("generic claude-sonnet-4.6(max) equals its base caps (existing behavior kept)", () => {
    expect(getCapabilitiesForModel(null, "claude-sonnet-4.6(max)")).toEqual(getCapabilitiesForModel(null, "claude-sonnet-4.6"));
  });

  it("x-preview-f-free keeps fork videoInput + opencode format", () => {
    expect(getCapabilitiesForModel("opencode", "x-preview-f-free")).toMatchObject({
      vision: true,
      videoInput: true,
      reasoning: true,
      thinkingFormat: "opencode",
    });
  });
});
