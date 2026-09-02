import { describe, expect, it } from "vitest";
import { prepareClaudeRequest } from "open-sse/translator/formats/claude.js";

// DeepSeek's Anthropic-compatible endpoint rejects a thinking-mode request whose
// assistant turns come back without their thinking: "The `content[].thinking` in
// the thinking mode must be passed back to the API" (#2397, #1786). The shape
// that broke was the ordinary multi-turn tool conversation, where the FINAL
// assistant turn is plain text and carries no tool_use.
const thinkingBody = (messages) => ({
  model: "deepseek-v4-pro",
  max_tokens: 1024,
  thinking: { type: "enabled", budget_tokens: 2048 },
  messages,
});

const thinkingBlocks = (msg) =>
  (msg.content || []).filter((b) => b.type === "thinking" || b.type === "redacted_thinking");

describe("DeepSeek thinking mode gets its thinking echoed back (#2397, #1786)", () => {
  it("a plain-text assistant turn after a tool result carries a thinking block", () => {
    const body = prepareClaudeRequest(thinkingBody([
      { role: "user", content: [{ type: "text", text: "read the file" }] },
      { role: "assistant", content: [
        { type: "thinking", thinking: "I should read it" },
        { type: "tool_use", id: "t1", name: "read_file", input: { path: "a.py" } },
      ] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "print(1)" }] },
      { role: "assistant", content: [{ type: "text", text: "It prints 1." }] },
      { role: "user", content: [{ type: "text", text: "thanks" }] },
    ]), "deepseek");

    const finalAssistant = body.messages.filter((m) => m.role === "assistant").at(-1);
    expect(thinkingBlocks(finalAssistant)).toHaveLength(1);
    expect(finalAssistant.content[0].type).toBe("thinking");
  });

  it("the placeholder DeepSeek gets is unsigned, since it does not want Anthropic's signature", () => {
    const body = prepareClaudeRequest(thinkingBody([
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
      { role: "user", content: [{ type: "text", text: "again" }] },
    ]), "deepseek");
    const assistant = body.messages.find((m) => m.role === "assistant");
    expect(assistant.content[0].type).toBe("thinking");
    expect(assistant.content[0].signature).toBeUndefined();
  });

  it("real thinking the client sent is kept, not replaced by a placeholder", () => {
    const body = prepareClaudeRequest(thinkingBody([
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [
        { type: "thinking", thinking: "the real reasoning" },
        { type: "text", text: "hello" },
      ] },
      { role: "user", content: [{ type: "text", text: "again" }] },
    ]), "deepseek");
    const assistant = body.messages.find((m) => m.role === "assistant");
    expect(thinkingBlocks(assistant)).toHaveLength(1);
    expect(assistant.content[0].thinking).toBe("the real reasoning");
  });

  it("nothing is added when thinking is not enabled", () => {
    const body = prepareClaudeRequest({
      model: "deepseek-v4-pro",
      max_tokens: 1024,
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
        { role: "assistant", content: [{ type: "text", text: "hello" }] },
        { role: "user", content: [{ type: "text", text: "again" }] },
      ],
    }, "deepseek");
    const assistant = body.messages.find((m) => m.role === "assistant");
    expect(thinkingBlocks(assistant)).toHaveLength(0);
  });
});

describe("the widening is scoped to DeepSeek", () => {
  it("a plain-text assistant turn to Claude native is left alone", () => {
    // Anthropic wants thinking to LEAD a tool-use turn and rejects an unsigned
    // block, so a placeholder here would trade one 400 for another.
    const body = prepareClaudeRequest(thinkingBody([
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "hello" }] },
      { role: "user", content: [{ type: "text", text: "again" }] },
    ]), "claude");
    const assistant = body.messages.find((m) => m.role === "assistant");
    expect(thinkingBlocks(assistant)).toHaveLength(0);
  });

  it("a Claude tool-use turn without thinking gets NO fabricated block", () => {
    // This assertion is the reverse of what it was when this file was written.
    // The placeholder was believed to be the safe thing for a Claude tool-use
    // turn, and #2227 refuted it: Anthropic verifies the signature, so the
    // default one is an invalid credential rather than a lenient stand-in, and
    // the request comes back "Invalid `signature` in `thinking` block". Nothing
    // may be invented for the one upstream that can tell.
    const body = prepareClaudeRequest(thinkingBody([
      { role: "user", content: [{ type: "text", text: "read it" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read_file", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
    ]), "claude");
    const assistant = body.messages.find((m) => m.role === "assistant");
    expect(assistant.content.some((b) => b.type === "thinking")).toBe(false);
  });
});
