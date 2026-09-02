import { describe, it, expect } from "vitest";
import { translateNonStreamingResponse } from "open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "open-sse/translator/formats.js";

const CLAUDE_BODY = {
  id: "msg_1",
  model: "claude-fable-5",
  content: [{ type: "text", text: "hello" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 3, output_tokens: 2 },
};

const OLLAMA_BODY = {
  model: "llama3",
  message: { role: "assistant", content: "hello" },
  done: true,
};

describe("a Responses client gets output[], whatever the provider speaks (#2885)", () => {
  for (const [name, target, body] of [
    ["claude", FORMATS.CLAUDE, CLAUDE_BODY],
    ["ollama", FORMATS.OLLAMA, OLLAMA_BODY],
  ]) {
    it(`converts a ${name} reply for a Responses client`, () => {
      const out = translateNonStreamingResponse(body, target, FORMATS.OPENAI_RESPONSES);
      // The client maps over output; a body without it throws
      // "Cannot read properties of undefined (reading 'map')".
      expect(Array.isArray(out.output)).toBe(true);
      expect(out.choices).toBeUndefined();
    });

    it(`still returns choices[] for an ${name} reply to an OpenAI client`, () => {
      const out = translateNonStreamingResponse(body, target, FORMATS.OPENAI);
      expect(Array.isArray(out.choices)).toBe(true);
      expect(out.output).toBeUndefined();
    });
  }

  it("matches what the gemini branch already did", () => {
    const gem = translateNonStreamingResponse(
      { candidates: [{ content: { parts: [{ text: "hi" }] }, finishReason: "STOP" }] },
      FORMATS.GEMINI,
      FORMATS.OPENAI_RESPONSES,
    );
    expect(Array.isArray(gem.output)).toBe(true);
  });
});
