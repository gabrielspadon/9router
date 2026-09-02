// #3644 — z-ai/glm-5.3-flash over the Cline provider is reported as returning no
// usable completion while the vendor's own extension renders it fine. Cline's
// gateway is OpenRouter-shaped (registry/cline.js sends OpenRouter's
// HTTP-Referer / X-Title attribution pair), and OpenRouter spells reasoning
// `message.reasoning` / `delta.reasoning`, not `reasoning_content`.
// glm-5.3-flash cannot turn thinking off (capabilities.js PATTERN
// *glm-5.3-flash* thinkingCanDisable:false), so a short-budget turn is
// reasoning-only — and the non-streaming readers only knew the
// `reasoning_content` spelling, so the turn read as empty. The streaming side
// already accepted the wider set (streamHelpers.hasValuableContent, and
// translator/concerns/reasoning.extractReasoningText, which the streaming
// translators use); these readers had drifted from it.
import { describe, it, expect } from "vitest";
import {
  hasUsefulContent,
  translateNonStreamingResponse,
} from "open-sse/handlers/chatCore/nonStreamingHandler.js";
import { parseSSEToOpenAIResponse } from "open-sse/handlers/chatCore/sseToJsonHandler.js";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

const reasoningOnly = (message) => ({
  id: "chatcmpl-1",
  object: "chat.completion",
  model: "z-ai/glm-5.3-flash",
  choices: [{ index: 0, message: { role: "assistant", content: "", ...message }, finish_reason: "length" }],
  usage: { prompt_tokens: 9, completion_tokens: 1024 },
});

describe("OpenRouter-shaped reasoning over Cline (#3644)", () => {
  it("is the model that cannot disable thinking, so reasoning-only turns are expected", () => {
    expect(getCapabilitiesForModel("cline", "z-ai/glm-5.3-flash").thinkingCanDisable).toBe(false);
  });

  it("counts message.reasoning as usable content", () => {
    expect(hasUsefulContent(reasoningOnly({ reasoning: "weighing the options" }), false, false)).toBe(true);
  });

  it("counts reasoning_details[] as usable content", () => {
    expect(
      hasUsefulContent(reasoningOnly({ reasoning_details: [{ text: "step one" }] }), false, false),
    ).toBe(true);
  });

  it("still rejects a genuinely empty completion", () => {
    expect(hasUsefulContent(reasoningOnly({}), false, false)).toBe(false);
  });

  it("keeps streamed delta.reasoning when converting SSE to a JSON completion", () => {
    const sse = [
      'data: {"id":"c1","model":"z-ai/glm-5.3-flash","choices":[{"index":0,"delta":{"role":"assistant"}}]}',
      'data: {"id":"c1","choices":[{"index":0,"delta":{"reasoning":"weighing "}}]}',
      'data: {"id":"c1","choices":[{"index":0,"delta":{"reasoning":"the options"}}]}',
      'data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"length"}]}',
      "data: [DONE]",
    ].join("\n");
    const out = parseSSEToOpenAIResponse(sse, "z-ai/glm-5.3-flash");
    expect(out.choices[0].message.reasoning_content).toBe("weighing the options");
  });

  it("gives a Claude-format client a thinking block for message.reasoning", () => {
    const msg = translateNonStreamingResponse(
      reasoningOnly({ reasoning: "weighing the options" }),
      "openai",
      "claude",
    );
    expect(msg.content).toContainEqual({ type: "thinking", thinking: "weighing the options" });
  });

  it("unwraps Cline's { data, success } envelope before reading choices", () => {
    // Already covered by the non-streaming handler; pinned so the reader keeps
    // both halves of the Cline shape.
    const enveloped = { success: true, data: reasoningOnly({ reasoning: "x" }) };
    expect(hasUsefulContent(enveloped, false, false)).toBe(false);
    expect(hasUsefulContent(enveloped.data, false, false)).toBe(true);
  });
});
