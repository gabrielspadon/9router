import { describe, expect, it } from "vitest";
import { stripUnsupportedParams } from "open-sse/translator/concerns/paramSupport.js";

const roles = (body) => body.messages.map((m) => m.role);

// Mistral answers 400 "Unexpected role 'user' after role 'tool'". Its docs state
// the rule directly: an assistant message with tool_calls "must be followed by a
// 'tool' message, which is then followed by another assistant message". An
// OpenAI client may legitimately open a new user turn straight after tool
// results, so the gateway has to repair the shape (#1152).
describe("a tool message is followed by an assistant message (#1152)", () => {
  const conversation = () => ({
    messages: [
      { role: "user", content: "weather?" },
      { role: "assistant", tool_calls: [{ id: "a", type: "function", function: { name: "w", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "a", content: "22" },
      { role: "user", content: "and tomorrow?" },
    ],
  });

  it("an assistant turn is inserted between tool results and the next user turn", () => {
    const body = conversation();
    stripUnsupportedParams("nvidia", "mistralai/mistral-large", body);
    expect(roles(body)).toEqual(["user", "assistant", "tool", "assistant", "user"]);
    expect(body.messages[3]).toEqual({ role: "assistant", content: "" });
  });

  it("the user's own content is untouched", () => {
    // Repairing the shape must not edit what the user said, and must not
    // disturb the tool result it sits behind.
    const body = conversation();
    stripUnsupportedParams("nvidia", "mistralai/mistral-large", body);
    expect(body.messages.at(-1)).toEqual({ role: "user", content: "and tomorrow?" });
    expect(body.messages[2]).toEqual({ role: "tool", tool_call_id: "a", content: "22" });
  });

  it("consecutive tool results are left alone", () => {
    // Parallel tool calls produce several tool messages in a row; only the
    // boundary out of the tool block needs an assistant.
    const body = { messages: [
      { role: "assistant", tool_calls: [] },
      { role: "tool", tool_call_id: "a", content: "1" },
      { role: "tool", tool_call_id: "b", content: "2" },
      { role: "user", content: "next" },
    ] };
    stripUnsupportedParams("nvidia", "mistralai/mistral-large", body);
    expect(roles(body)).toEqual(["assistant", "tool", "tool", "assistant", "user"]);
  });

  it("a conversation that already has the assistant turn is not padded", () => {
    const body = { messages: [
      { role: "tool", tool_call_id: "a", content: "1" },
      { role: "assistant", content: "it is 22" },
      { role: "user", content: "thanks" },
    ] };
    stripUnsupportedParams("nvidia", "mistralai/mistral-large", body);
    expect(roles(body)).toEqual(["tool", "assistant", "user"]);
  });

  it("a trailing tool message is left alone", () => {
    // Nothing follows it, so there is no ordering violation to repair.
    const body = { messages: [{ role: "user", content: "x" }, { role: "tool", tool_call_id: "a", content: "1" }] };
    stripUnsupportedParams("nvidia", "mistralai/mistral-large", body);
    expect(roles(body)).toEqual(["user", "tool"]);
  });

  it("it applies on the direct Mistral provider too, not only through NVIDIA", () => {
    const body = conversation();
    stripUnsupportedParams("mistral", "mistral-large-latest", body);
    expect(roles(body)).toEqual(["user", "assistant", "tool", "assistant", "user"]);
  });

  it("a non-Mistral model on the same provider is untouched", () => {
    const body = conversation();
    stripUnsupportedParams("nvidia", "z-ai/glm-5.2", body);
    expect(roles(body)).toEqual(["user", "assistant", "tool", "user"]);
  });
});
