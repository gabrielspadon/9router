import { describe, expect, it } from "vitest";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";

const toolTurn = (blocks) => ({
  model: "m",
  messages: [
    { role: "user", content: "hi" },
    { role: "assistant", content: blocks },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
  ],
});
const assistantWithCalls = (body) =>
  claudeToOpenAIRequest("m", body, false).messages.find((m) => m.tool_calls);

// Kimi with thinking enabled rejects the whole request when an assistant
// tool-call message lacks reasoning_content: "thinking is enabled but
// reasoning_content is missing in assistant tool call message at index 4".
describe("an assistant tool-call turn always carries reasoning_content (#1480)", () => {
  it("emits an empty string when the assistant produced no thinking", () => {
    const msg = assistantWithCalls(toolTurn([{ type: "tool_use", id: "t1", name: "f", input: {} }]));
    expect(msg).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(msg, "reasoning_content")).toBe(true);
    expect(msg.reasoning_content).toBe("");
  });

  it("still carries real thinking when there was some", () => {
    const msg = assistantWithCalls(toolTurn([
      { type: "thinking", thinking: "step one" },
      { type: "tool_use", id: "t1", name: "f", input: {} },
    ]));
    expect(msg.reasoning_content).toContain("step one");
  });

  it("keeps the tool_calls themselves intact", () => {
    const msg = assistantWithCalls(toolTurn([{ type: "tool_use", id: "t1", name: "f", input: { a: 1 } }]));
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls[0].function.name).toBe("f");
  });

  it("does not add the field to a plain assistant turn with no tool calls", () => {
    // Only the tool-call shape is rejected by Kimi; leave ordinary turns alone.
    const out = claudeToOpenAIRequest("m", {
      model: "m",
      messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "plain answer" }],
    }, false);
    const plain = out.messages.find((m) => m.role === "assistant" && !m.tool_calls);
    expect(plain).toBeTruthy();
    expect(plain.reasoning_content).toBeUndefined();
  });

  it("keeps text content beside the tool calls", () => {
    const msg = assistantWithCalls(toolTurn([
      { type: "text", text: "calling now" },
      { type: "tool_use", id: "t1", name: "f", input: {} },
    ]));
    expect(JSON.stringify(msg.content)).toContain("calling now");
  });
});
