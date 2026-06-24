import { describe, expect, it } from "vitest";

import { capabilitiesFromServiceKind, getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("capabilitiesFromServiceKind", () => {
  it("maps imageToText custom models to vision-capable runtime models", () => {
    expect(capabilitiesFromServiceKind("imageToText")).toMatchObject({ vision: true });
  });

  it("maps media output/input custom model kinds to runtime capabilities", () => {
    expect(capabilitiesFromServiceKind("image")).toMatchObject({ imageOutput: true });
    expect(capabilitiesFromServiceKind("stt")).toMatchObject({ audioInput: true });
    expect(capabilitiesFromServiceKind("tts")).toMatchObject({ audioOutput: true });
  });
});

describe("getCapabilitiesForModel", () => {
  it("treats GPT-5.4/5.5 models as vision-capable", () => {
    for (const model of ["gpt-5.4", "gpt-5.4-mini", "gpt-5.5"]) {
      expect(getCapabilitiesForModel("openai-compatible-chat-99999999-8888-4777-8666-555555555555", model))
        .toMatchObject({ vision: true, reasoning: true, thinkingFormat: "openai" });
      expect(getCapabilitiesForModel("openai-compatible-chat-99999999-8888-4777-8666-555555555555", `runtime-compatible/${model}`))
        .toMatchObject({ vision: true, reasoning: true, thinkingFormat: "openai" });
    }
  });
});
