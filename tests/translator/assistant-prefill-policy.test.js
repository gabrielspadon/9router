import { describe, expect, it } from "vitest";
import { normalizeClaudePassthrough, prepareClaudeRequest } from "../../open-sse/translator/formats/claude.js";

const continuationPattern = /continue.*without repeating/i;

function translated(messages, headers = null) {
  return prepareClaudeRequest({
    model: "claude-sonnet-4-6",
    messages: structuredClone(messages),
  }, "anthropic", null, null, headers);
}

function passthrough(messages, headers = null) {
  return normalizeClaudePassthrough({
    model: "claude-sonnet-4-6",
    messages: structuredClone(messages),
  }, "claude-sonnet-4-6", headers);
}

describe.each([
  ["translated Claude target", translated],
  ["native Claude passthrough", passthrough],
])("assistant prefill policy — %s", (_name, run) => {
  it.each([
    ["is absent", { type: "thinking", signature: "Eg==" }],
    ["is empty", { type: "thinking", thinking: "", signature: "Eg==" }],
    ["contains only whitespace", { type: "thinking", thinking: " \n\t", signature: "Eg==" }],
  ])("drops signed thinking whose content %s before Claude preparation", (_case, thinking) => {
    const out = run([
      { role: "user", content: "Start" },
      { role: "assistant", content: [
        thinking,
        { type: "text", text: "Completed response" },
      ] },
      { role: "user", content: "Next" },
    ]);

    expect(out.messages[1].content).not.toContainEqual(expect.objectContaining({ type: "thinking" }));
    expect(out.messages[1].content).toContainEqual(expect.objectContaining({
      type: "text",
      text: "Completed response",
    }));
  });

  it("preserves non-empty signed thinking", () => {
    const out = run([
      { role: "user", content: "Start" },
      { role: "assistant", content: [
        { type: "thinking", thinking: "Work through the options.", signature: "Eg==" },
        { type: "text", text: "Completed response" },
      ] },
      { role: "user", content: "Next" },
    ]);

    expect(out.messages[1].content).toContainEqual({
      type: "thinking",
      thinking: "Work through the options.",
      signature: "Eg==",
    });
  });

  it("preserves valid redacted thinking", () => {
    const out = run([
      { role: "user", content: "Start" },
      { role: "assistant", content: [
        { type: "redacted_thinking", data: "ENCRYPTED_BLOB", signature: "Eg==" },
        { type: "text", text: "Completed response" },
      ] },
      { role: "user", content: "Next" },
    ]);

    expect(out.messages[1].content).toContainEqual({
      type: "redacted_thinking",
      data: "ENCRYPTED_BLOB",
      signature: "Eg==",
    });
  });

  it("turns trailing assistant text into a continuation turn", () => {
    const out = run([
      { role: "user", content: "Start" },
      { role: "assistant", content: [{ type: "text", text: "Partial answer" }] },
    ]);

    expect(out.messages.map(message => message.role)).toEqual(["user", "assistant", "user"]);
    expect(JSON.stringify(out.messages.at(-1).content)).toMatch(continuationPattern);
  });

  it("drops an empty trailing assistant", () => {
    const out = run([
      { role: "user", content: "Start" },
      { role: "assistant", content: [] },
    ]);

    expect(out.messages).toHaveLength(1);
    expect(out.messages[0].role).toBe("user");
  });

  it("completes trailing tool_use with an error tool_result", () => {
    const out = run([
      { role: "user", content: "Start" },
      { role: "assistant", content: [{ type: "tool_use", id: "tool-1", name: "lookup", input: {} }] },
    ]);

    expect(out.messages.at(-1)).toEqual({
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: "tool-1",
        is_error: true,
        content: expect.stringMatching(/not completed/i),
      }],
    });
  });

  it("keeps final user unchanged", () => {
    const out = run([{ role: "user", content: "Start" }]);

    expect(out.messages).toHaveLength(1);
    expect(out.messages[0].role).toBe("user");
  });

  it("preserves assistant prefill when explicitly requested", () => {
    const out = run([
      { role: "user", content: "Start" },
      { role: "assistant", content: "Partial answer" },
    ], { "x-tokenproxy-assistant-prefill": "preserve" });

    expect(out.messages).toHaveLength(2);
    expect(out.messages.at(-1).role).toBe("assistant");
    expect(JSON.stringify(out.messages.at(-1))).toContain("Partial answer");
  });

  it("preserves an empty trailing assistant when explicitly requested", () => {
    const out = run([
      { role: "user", content: "Start" },
      { role: "assistant", content: [] },
    ], { "x-tokenproxy-assistant-prefill": "preserve" });

    expect(out.messages.at(-1)).toEqual({ role: "assistant", content: [] });
  });
});

describe("native Claude blank thinking cleanup", () => {
  it("drops a nonfinal assistant left empty by blank thinking removal and merges adjacent users", () => {
    const out = passthrough([
      { role: "user", content: "Start" },
      { role: "assistant", content: [{ type: "thinking", thinking: " \n\t", signature: "Eg==" }] },
      { role: "user", content: "Next" },
    ]);

    expect(out.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "Start" },
          { type: "text", text: "Next" },
        ],
      },
    ]);
  });
});
