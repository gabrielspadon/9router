// Format coverage and non-tamper tests for the shared system injector
// (open-sse/rtk/systemInject.js via caveman.js / ponytail.js).
// Each supported body shape gets exactly one injected block, in the right
// place, with every other field byte-preserved.

import { describe, it, expect } from "vitest";
import { injectCaveman } from "../../open-sse/rtk/caveman.js";
import { injectPonytail } from "../../open-sse/rtk/ponytail.js";
import { CAVEMAN_LEVELS, CAVEMAN_PROMPTS } from "../../open-sse/rtk/cavemanPrompts.js";

const PROMPT = CAVEMAN_PROMPTS[CAVEMAN_LEVELS.FULL];
const SIG = PROMPT.trim().slice(0, 100);

// Non-tamper fixture shared by format tests: everything except the system
// field must survive injection byte-for-byte.
function openAIBody() {
  return {
    model: "gpt-4o",
    max_tokens: 2048,
    temperature: 0.2,
    tools: [{ type: "function", function: { name: "fn", parameters: { type: "object" } } }],
    messages: [
      { role: "system", content: "sys text" },
      { role: "user", content: "hi" },
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "fn", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "result" },
    ],
  };
}

describe("format coverage", () => {
  it("Claude string system: prompt appended once, then deduped", () => {
    const body = { model: "claude", max_tokens: 1, system: "base", messages: [] };
    injectCaveman(body, "claude", CAVEMAN_LEVELS.FULL);
    expect(body.system).toBe(`base\n\n${PROMPT}`);
    injectCaveman(body, "claude", CAVEMAN_LEVELS.FULL);
    expect(body.system).toBe(`base\n\n${PROMPT}`);
  });

  it("Claude array-of-blocks: exactly one text block, inserted before the last cache_control block", () => {
    const body = {
      model: "claude",
      system: [
        { type: "text", text: "first", cache_control: { type: "ephemeral" } },
        { type: "text", text: "tail", cache_control: { type: "ephemeral" } },
      ],
      messages: [],
    };
    injectCaveman(body, "claude", CAVEMAN_LEVELS.FULL);
    expect(body.system).toHaveLength(3);
    const injectedIdx = body.system.findIndex(b => b.text === PROMPT);
    expect(injectedIdx).toBe(1);
    // cache_control blocks untouched, still on their original texts
    expect(body.system[0]).toEqual({ type: "text", text: "first", cache_control: { type: "ephemeral" } });
    expect(body.system[2]).toEqual({ type: "text", text: "tail", cache_control: { type: "ephemeral" } });
    // re-inject is a no-op
    injectCaveman(body, "claude", CAVEMAN_LEVELS.FULL);
    expect(body.system).toHaveLength(3);
  });

  it("OpenAI system-as-message (string content): appended with separator", () => {
    const body = openAIBody();
    const before = { ...body, messages: body.messages.map(m => ({ ...m })) };
    injectCaveman(body, "openai", CAVEMAN_LEVELS.FULL);
    expect(body.messages[0].content).toBe(`sys text\n\n${PROMPT}`);
    for (let i = 1; i < body.messages.length; i++) {
      expect(body.messages[i]).toEqual(before.messages[i]);
    }
  });

  it("OpenAI system-as-message (array content): mirrors existing part type, appends one part", () => {
    const body = openAIBody();
    body.messages[0].content = [{ type: "text", text: "sys text" }];
    injectCaveman(body, "openai", CAVEMAN_LEVELS.FULL);
    expect(body.messages[0].content).toHaveLength(2);
    expect(body.messages[0].content[1]).toEqual({ type: "text", text: PROMPT });
  });

  it("OpenAI with no system message: unshifts one system message at index 0", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectCaveman(body, "openai", CAVEMAN_LEVELS.FULL);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({ role: "system", content: PROMPT });
    expect(body.messages[1]).toEqual({ role: "user", content: "hi" });
  });

  it("Responses instructions (string): appended, deduped on re-inject", () => {
    const body = { model: "gpt-5", instructions: "be brief", input: [{ role: "user", content: "hi" }] };
    injectCaveman(body, "openai-responses", CAVEMAN_LEVELS.FULL);
    expect(body.instructions).toBe(`be brief\n\n${PROMPT}`);
    expect(body.input).toHaveLength(1);
    injectCaveman(body, "openai-responses", CAVEMAN_LEVELS.FULL);
    expect(body.instructions).toBe(`be brief\n\n${PROMPT}`);
  });

  it("Responses without instructions: unshifts typed message item carrying input_text part", () => {
    const body = { model: "gpt-5", input: [{ role: "user", content: "hi" }] };
    injectCaveman(body, "openai-responses", CAVEMAN_LEVELS.FULL);
    expect(body.input).toHaveLength(2);
    expect(body.input[0]).toEqual({
      type: "message",
      role: "system",
      content: [{ type: "input_text", text: PROMPT }],
    });
    expect(body.input[1]).toEqual({ role: "user", content: "hi" });
  });

  it("Gemini systemInstruction parts: appends exactly one part, deduped", () => {
    const body = {
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      systemInstruction: { parts: [{ text: "base sys" }] },
    };
    injectCaveman(body, "gemini", CAVEMAN_LEVELS.FULL);
    expect(body.systemInstruction.parts).toHaveLength(2);
    expect(body.systemInstruction.parts[1]).toEqual({ text: PROMPT });
    expect(body.contents).toHaveLength(1);
    injectCaveman(body, "gemini", CAVEMAN_LEVELS.FULL);
    expect(body.systemInstruction.parts).toHaveLength(2);
  });

  it("Gemini snake_case system_instruction is respected", () => {
    const body = { system_instruction: { parts: [{ text: "base" }] } };
    injectCaveman(body, "gemini", CAVEMAN_LEVELS.FULL);
    expect(body.system_instruction.parts).toHaveLength(2);
    expect(body).not.toHaveProperty("systemInstruction");
  });

  it("Antigravity wraps Gemini shape in body.request", () => {
    const body = { request: { contents: [], systemInstruction: { parts: [{ text: "base" }] } } };
    injectCaveman(body, "antigravity", CAVEMAN_LEVELS.FULL);
    expect(body.request.systemInstruction.parts).toHaveLength(2);
    expect(body.request.systemInstruction.parts[1]).toEqual({ text: PROMPT });
  });

  it("DEFECT TP-INJ-1 (high): Gemini systemInstruction as plain string is clobbered", () => {
    // injectGeminiSystem only understands { parts: [...] }. A string
    // systemInstruction falls through to target[key] = { parts: [...] },
    // silently discarding the original system text instead of appending.
    // Actual behavior today: {"systemInstruction":{"parts":[{"text":PROMPT}]}} —
    // "original system text" is lost. Fix: coerce string to parts and append.
    const body = { systemInstruction: "original system text" };
    injectCaveman(body, "gemini", CAVEMAN_LEVELS.FULL);
    expect(JSON.stringify(body)).toContain("original system text");
  });
});

describe("non-tamper", () => {
  it("tools array, model, max_tokens, temperature untouched (openai)", () => {
    const body = openAIBody();
    const { tools, model, max_tokens, temperature, messages } = body;
    const messagesBefore = JSON.parse(JSON.stringify(messages));
    injectCaveman(body, "openai", CAVEMAN_LEVELS.FULL);
    expect(body.tools).toBe(tools);
    expect(body.model).toBe(model);
    expect(body.max_tokens).toBe(max_tokens);
    expect(body.temperature).toBe(temperature);
    // messages after index 0 (system) untouched, including tool_calls
    expect(body.messages.slice(1)).toEqual(messagesBefore.slice(1));
  });

  it("Claude body: thinking blocks + signatures, cache_control, tools, model all untouched", () => {
    const body = {
      model: "claude-opus-4-1",
      max_tokens: 8192,
      temperature: 0.7,
      tools: [{ name: "tool_a", input_schema: { type: "object" } }],
      system: [
        { type: "text", text: "sys a", cache_control: { type: "ephemeral" } },
        { type: "text", text: "sys b", cache_control: { type: "ephemeral" } },
      ],
      messages: [
        { role: "user", content: "q" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hmm", signature: "sig123" },
            { type: "text", text: "answer" },
          ],
        },
      ],
    };
    const before = JSON.parse(JSON.stringify(body));
    injectCaveman(body, "claude", CAVEMAN_LEVELS.FULL);
    expect(body.model).toBe(before.model);
    expect(body.max_tokens).toBe(before.max_tokens);
    expect(body.temperature).toBe(before.temperature);
    expect(body.tools).toEqual(before.tools);
    expect(body.messages).toEqual(before.messages);
    // system array: same length +1, cache blocks intact, one injected text block
    expect(body.system).toHaveLength(before.system.length + 1);
    expect(body.system.filter(b => b.cache_control)).toEqual(before.system.filter(b => b.cache_control));
    expect(body.system.filter(b => b.text === PROMPT)).toHaveLength(1);
  });

  it("ponytail injector non-tamper on the same shapes", () => {
    const body = openAIBody();
    const messagesBefore = JSON.parse(JSON.stringify(body.messages));
    injectPonytail(body, "openai", "full");
    expect(body.messages.slice(1)).toEqual(messagesBefore.slice(1));
    expect(body.messages[0].content).toContain(messagesBefore[0].content);
  });
});
