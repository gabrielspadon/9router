import { describe, expect, it } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";
import { typeResponsesInputItems } from "../../open-sse/translator/formats/responsesApi.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// A Responses upstream matches every input[] item against the item union on its
// `type`. An item carrying only { role, content } matches nothing and comes back
// as "Unknown parameter: 'input[0].content'" (#3390). Producers that append a
// turn to an input array already built emit exactly that shape, and the
// same-format Responses passthrough runs no translator that would repair it.
const untyped = (body) =>
  body.input.filter((item) => item && typeof item === "object" && item.role && !item.type);

describe("every Responses input item is typed before it leaves (#3390)", () => {
  it("types an untyped item on the same-format Responses passthrough", () => {
    const body = {
      input: [
        { role: "user", content: "hi" },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] },
      ],
    };
    const out = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES, "gpt-5.6-terra", body);
    expect(untyped(out)).toHaveLength(0);
    expect(out.input[0].type).toBe("message");
  });

  it("types an untyped item when a chat-shaped caller already carries input[]", () => {
    const body = { input: [{ role: "user", content: "hi" }] };
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "gpt-5.6-terra", body);
    expect(untyped(out)).toHaveLength(0);
    expect(out.input[0].type).toBe("message");
  });

  it("gives a typed message the content-part array the item union requires", () => {
    const body = { input: [{ role: "user", content: "hi" }, { role: "assistant", content: "ok" }] };
    typeResponsesInputItems(body);
    expect(body.input[0].content).toEqual([{ type: "input_text", text: "hi" }]);
    expect(body.input[1].content).toEqual([{ type: "output_text", text: "ok" }]);
  });

  it("leaves an already-typed item and a non-message item untouched", () => {
    const reasoning = { type: "reasoning", summary: [], encrypted_content: "blob" };
    const call = { type: "function_call", call_id: "c1", name: "Bash", arguments: "{}" };
    const message = { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] };
    const body = { input: [reasoning, call, message] };
    typeResponsesInputItems(body);
    expect(body.input[0]).toEqual({ type: "reasoning", summary: [], encrypted_content: "blob" });
    expect(body.input[1]).toEqual(call);
    expect(body.input[2].content).toEqual([{ type: "input_text", text: "hi" }]);
  });

  it("is a no-op on a chat-completions body with no input[]", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    typeResponsesInputItems(body);
    expect(body.messages[0]).toEqual({ role: "user", content: "hi" });
  });
});
