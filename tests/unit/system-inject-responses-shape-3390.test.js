import { describe, expect, it } from "vitest";
import { injectSystemPrompt } from "../../open-sse/rtk/systemInject.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// injectSystemPrompt picks the turn array by SHAPE (messages vs input) but
// decided the item shape from the format LABEL. A body carrying `input` is a
// Responses request whatever the label says, and an item unshifted without a
// `type` is rejected by the API with "Unknown parameter: 'input[0].content'".
const typedContent = (item) => Array.isArray(item.content) && item.content.every((c) => typeof c?.type === "string");

describe("a Responses input array always gets a typed item (#3390)", () => {
  it("types the injected item even when the format label is not responses", () => {
    const body = { input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }] };
    injectSystemPrompt(body, FORMATS.OPENAI, "RULES");
    expect(body.input[0].type).toBe("message");
    expect(typedContent(body.input[0])).toBe(true);
    expect(body.input[0].content[0].text).toContain("RULES");
  });

  it("still types it when the label does say responses", () => {
    const body = { input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }] };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "RULES");
    expect(body.input[0].type).toBe("message");
    expect(typedContent(body.input[0])).toBe(true);
  });

  it("appends into an existing system item as typed content", () => {
    const body = {
      input: [
        { type: "message", role: "system", content: [{ type: "input_text", text: "BASE" }] },
        { role: "user", content: [{ type: "input_text", text: "hi" }] },
      ],
    };
    injectSystemPrompt(body, FORMATS.OPENAI, "RULES");
    expect(body.input[0].type).toBe("message");
    expect(typedContent(body.input[0])).toBe(true);
    expect(JSON.stringify(body.input[0].content)).toContain("RULES");
  });

  it("leaves a chat-completions messages array on the plain string shape", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, "RULES");
    expect(body.messages[0].role).toBe("system");
    expect(typeof body.messages[0].content).toBe("string");
    expect(body.messages[0].type).toBeUndefined();
  });

  it("prefers top-level instructions when present, touching neither array", () => {
    const body = { instructions: "BASE", input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }] };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, "RULES");
    expect(body.instructions).toContain("RULES");
    expect(body.input).toHaveLength(1);
  });
});

// The injector must never mutate caller arrays: caveman/ponytail replay the
// same injection on every request of a session, and a shared array would
// compound across retries the way the pre-#3566 RTK bug did.
describe("injectSystemPrompt never mutates caller collections (audit finding 11)", () => {
  it("claude: caller system array untouched, body gets a new one", () => {
    const system = [
      { type: "text", text: "base" },
      { type: "text", text: "cached", cache_control: { type: "ephemeral" } },
    ];
    const body = { system };
    expect(injectSystemPrompt(body, FORMATS.CLAUDE, "NEW RULES")).toBe(true);
    expect(system).toHaveLength(2); // caller array untouched
    expect(body.system).not.toBe(system);
    expect(body.system).toHaveLength(3);
    expect(body.system[1].text).toBe("NEW RULES"); // inserted BEFORE the cache anchor
    expect(body.system[2].text).toBe("cached");
  });

  it("openai: caller messages array and the system message content array untouched", () => {
    const content = [{ type: "text", text: "sys msg" }];
    const messages = [{ role: "system", content }, { role: "user", content: "hi" }];
    const body = { messages };
    expect(injectSystemPrompt(body, FORMATS.OPENAI, "NEW RULES")).toBe(true);
    expect(messages).toHaveLength(2);
    expect(content).toHaveLength(1);
    expect(body.messages).not.toBe(messages);
    expect(body.messages[0].content).toHaveLength(2);
  });

  it("gemini: caller systemInstruction parts array untouched", () => {
    const parts = [{ text: "base instruction" }];
    const body = { systemInstruction: { parts } };
    expect(injectSystemPrompt(body, FORMATS.GEMINI, "NEW RULES")).toBe(true);
    expect(parts).toHaveLength(1);
    expect(body.systemInstruction.parts).toHaveLength(2);
    expect(body.systemInstruction.parts[0]).toBe(parts[0]); // shared first part, not cloned content
  });
});
