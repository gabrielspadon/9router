import { describe, expect, it } from "vitest";
import { injectSystemPrompt } from "../../open-sse/rtk/systemInject.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Issue #3202 (and the array half of #2621 / #2497). The system-prompt injector
// appended a part typed `input_text` whenever the system message held an array,
// including on the chat/completions path. `input_text` is a Responses part
// type; a strict chat/completions provider rejects the whole request for it.

const PROMPT = "be terse";
const sysParts = (body) => body.messages[0].content;

describe("system injection uses the part type the body actually speaks (#3202)", () => {
  it("appends a text part on the chat/completions path", () => {
    const body = { messages: [{ role: "system", content: [{ type: "text", text: "base" }] }] };
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT);

    const added = sysParts(body).at(-1);
    expect(added.type).toBe("text");
    expect(added.text).toBe(PROMPT);
  });

  it("never emits a Responses part type on the chat/completions path", () => {
    const body = { messages: [{ role: "system", content: [{ type: "text", text: "base" }] }] };
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT);

    expect(sysParts(body).map((p) => p.type)).not.toContain("input_text");
  });

  it("keeps the Responses part type on the Responses path", () => {
    const body = { input: [{ type: "message", role: "system", content: [{ type: "input_text", text: "base" }] }] };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, PROMPT);

    const parts = body.input[0].content;
    expect(parts.at(-1).type).toBe("input_text");
  });

  it("mirrors an existing input_text array even off the Responses path", () => {
    // A translated body can carry Responses-shaped parts; matching what is
    // already there beats imposing one spelling on both.
    const body = { messages: [{ role: "system", content: [{ type: "input_text", text: "base" }] }] };
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT);

    expect(sysParts(body).at(-1).type).toBe("input_text");
  });

  it("still appends to a string system message", () => {
    const body = { messages: [{ role: "system", content: "base" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, PROMPT);

    expect(body.messages[0].content).toContain("base");
    expect(body.messages[0].content).toContain(PROMPT);
  });
});
