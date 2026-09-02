import { describe, expect, it } from "vitest";
import { stripUnsupportedParams } from "open-sse/translator/concerns/paramSupport.js";

// Groq is a strict OpenAI-schema gateway: an unknown top-level property is a
// hard 400, "property 'enable_thinking' is unsupported", and every request fails
// until the client strips it. Groq serves qwen/qwen3.6-27b, whose id resolves to
// the qwen thinking format once the vendor prefix is stripped, so TokenProxy emitted
// a field Groq has no schema for (#3014).
describe("groq drops thinking fields its schema rejects (#3014)", () => {
  it("enable_thinking is removed", () => {
    const body = { model: "qwen/qwen3.6-27b", enable_thinking: true, messages: [] };
    stripUnsupportedParams("groq", "qwen/qwen3.6-27b", body);
    expect(body).not.toHaveProperty("enable_thinking");
  });

  it("the Anthropic-shaped thinking object is removed too", () => {
    const body = { thinking: { type: "enabled", budget_tokens: 1024 }, messages: [] };
    stripUnsupportedParams("groq", "qwen/qwen3.6-27b", body);
    expect(body).not.toHaveProperty("thinking");
  });

  it("reasoning_effort survives, because Groq accepts it on gpt-oss", () => {
    // Dropping it would remove working control to fix a different field.
    const body = { reasoning_effort: "high", messages: [] };
    stripUnsupportedParams("groq", "openai/gpt-oss-120b", body);
    expect(body.reasoning_effort).toBe("high");
  });

  it("the rule is provider-scoped and does not touch another provider's qwen", () => {
    const body = { enable_thinking: true, messages: [] };
    stripUnsupportedParams("qwen", "qwen3.6-27b", body);
    expect(body.enable_thinking).toBe(true);
  });

  it("it applies to every groq model, since the schema is the gateway's", () => {
    const body = { enable_thinking: false, messages: [] };
    stripUnsupportedParams("groq", "groq/compound", body);
    expect(body).not.toHaveProperty("enable_thinking");
  });

  it("nothing else in the body is disturbed", () => {
    const body = { messages: [{ role: "user", content: "hi" }], temperature: 0.4, enable_thinking: true };
    stripUnsupportedParams("groq", "qwen/qwen3.6-27b", body);
    expect(body).toEqual({ messages: [{ role: "user", content: "hi" }], temperature: 0.4 });
  });
});
