import { describe, expect, it } from "vitest";
import { prepareClaudeRequest } from "open-sse/translator/formats/claude.js";
import { DEFAULT_THINKING_CLAUDE_SIGNATURE } from "open-sse/config/defaultThinkingSignature.js";

// A combo mixes models, so thinking blocks signed by something other than
// Claude leak into history; those are dropped, and a placeholder used to be
// inserted in their place when the turn called a tool. Anthropic verifies the
// signature cryptographically, so that placeholder is not a lenient stand-in,
// it is an invalid credential, and the request comes back
// "messages.N.content.0: Invalid `signature` in `thinking` block" (#2227) —
// the same 400 the drop exists to prevent, re-introduced by the repair.
const FOREIGN_SIG = "not-a-claude-signature";
const REAL_SIG = "EnJlYWxzaWc=";

const body = (assistantBlocks) => ({
  model: "claude-sonnet-4-6",
  max_tokens: 512,
  thinking: { type: "enabled", budget_tokens: 2048 },
  messages: [
    { role: "user", content: [{ type: "text", text: "read it" }] },
    { role: "assistant", content: assistantBlocks },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
  ],
});
const assistantOf = (out) => out.messages.find((m) => m.role === "assistant");
const thinkingIn = (msg) => (msg.content || []).filter((b) => b.type === "thinking");

describe("nothing is invented for the upstream that can verify it (#2227)", () => {
  it("a dropped foreign signature is not replaced by the default one", () => {
    const out = prepareClaudeRequest(body([
      { type: "thinking", thinking: "from another model", signature: FOREIGN_SIG },
      { type: "tool_use", id: "t1", name: "read_file", input: {} },
    ]), "claude");
    const a = assistantOf(out);
    expect(thinkingIn(a)).toHaveLength(0);
    expect(JSON.stringify(a)).not.toContain(DEFAULT_THINKING_CLAUDE_SIGNATURE);
  });

  it("a tool-use turn that never had thinking gets none invented either", () => {
    const out = prepareClaudeRequest(body([
      { type: "tool_use", id: "t1", name: "read_file", input: {} },
    ]), "claude");
    expect(thinkingIn(assistantOf(out))).toHaveLength(0);
  });

  it("the drop that this repair broke still works: foreign signatures do not survive", () => {
    const out = prepareClaudeRequest(body([
      { type: "thinking", thinking: "from another model", signature: FOREIGN_SIG },
      { type: "text", text: "answer" },
    ]), "claude");
    expect(JSON.stringify(assistantOf(out))).not.toContain(FOREIGN_SIG);
  });

  it("a genuine Claude signature is still forwarded untouched", () => {
    const out = prepareClaudeRequest(body([
      { type: "thinking", thinking: "real reasoning", signature: REAL_SIG },
      { type: "tool_use", id: "t1", name: "read_file", input: {} },
    ]), "claude");
    expect(thinkingIn(assistantOf(out))[0].signature).toBe(REAL_SIG);
  });

  it("the lenient anthropic-compatible family still gets its placeholder", () => {
    // That is who the default signature was for: an upstream that wants the
    // field present and does not verify it.
    const out = prepareClaudeRequest(body([
      { type: "tool_use", id: "t1", name: "read_file", input: {} },
    ]), "anthropic-compatible-abc");
    expect(thinkingIn(assistantOf(out))).toHaveLength(1);
  });

  it("and DeepSeek still gets its unsigned one", () => {
    const out = prepareClaudeRequest(body([
      { type: "tool_use", id: "t1", name: "read_file", input: {} },
    ]), "deepseek");
    const t = thinkingIn(assistantOf(out));
    expect(t).toHaveLength(1);
    expect(t[0].signature).toBeUndefined();
  });
});
