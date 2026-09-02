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
