import { describe, expect, it } from "vitest";
import { prepareClaudeRequest } from "open-sse/translator/formats/claude.js";
import { isValidClaudeSignature } from "open-sse/utils/claudeSignature.js";
import { DEFAULT_THINKING_CLAUDE_SIGNATURE } from "open-sse/config/defaultThinkingSignature.js";

// An anthropic-compatible upstream signs its own thinking blocks. Stamping the
// placeholder signature over a real one is a MODIFICATION, and the next turn
// comes back with "`thinking` or `redacted_thinking` blocks in the latest
// assistant message cannot be modified" — so a single turn works and every
// multi-turn conversation dies from the second turn on (#2693).
const REAL_SIG = "EnJlYWxzaWc=";

const body = (assistantBlocks) => ({
  model: "claude-opus-4-8",
  max_tokens: 512,
  thinking: { type: "enabled", budget_tokens: 2048 },
  messages: [
    { role: "user", content: [{ type: "text", text: "hi" }] },
    { role: "assistant", content: assistantBlocks },
    { role: "user", content: [{ type: "text", text: "and now?" }] },
  ],
});

const thinkingOf = (out) =>
  out.messages.find((m) => m.role === "assistant").content.find((b) => b.type === "thinking");

describe("a signed thinking block is replayed byte-for-byte (#2693)", () => {
  it("the sanity check: the fixture signature is one the validator accepts", () => {
    expect(isValidClaudeSignature(REAL_SIG)).toBe(true);
  });

  it("an anthropic-compatible provider does not overwrite a real signature", () => {
    const out = prepareClaudeRequest(body([
      { type: "thinking", thinking: "reasoned", signature: REAL_SIG },
      { type: "text", text: "answer" },
    ]), "anthropic-compatible-abc");
    expect(thinkingOf(out).signature).toBe(REAL_SIG);
  });

  it("but still fills one in when the upstream sent none", () => {
    // That fallback is why the branch exists; it must survive the fix.
    const out = prepareClaudeRequest(body([
      { type: "thinking", thinking: "reasoned" },
      { type: "text", text: "answer" },
    ]), "anthropic-compatible-abc");
    expect(thinkingOf(out).signature).toBe(DEFAULT_THINKING_CLAUDE_SIGNATURE);
  });

  it("and replaces one that cannot be a Claude signature at all", () => {
    const out = prepareClaudeRequest(body([
      { type: "thinking", thinking: "reasoned", signature: "not-a-signature" },
      { type: "text", text: "answer" },
    ]), "anthropic-compatible-abc");
    expect(thinkingOf(out).signature).toBe(DEFAULT_THINKING_CLAUDE_SIGNATURE);
  });

  it("Claude native keeps a valid signature and drops an invalid block, unchanged", () => {
    const kept = prepareClaudeRequest(body([
      { type: "thinking", thinking: "reasoned", signature: REAL_SIG },
      { type: "text", text: "answer" },
    ]), "claude");
    expect(thinkingOf(kept).signature).toBe(REAL_SIG);

    const dropped = prepareClaudeRequest(body([
      { type: "thinking", thinking: "reasoned", signature: "not-a-signature" },
      { type: "text", text: "answer" },
    ]), "claude");
    expect(thinkingOf(dropped)).toBeUndefined();
  });

  it("DeepSeek still passes its blocks through untouched", () => {
    const out = prepareClaudeRequest(body([
      { type: "thinking", thinking: "reasoned", signature: "deepseek-shaped" },
      { type: "text", text: "answer" },
    ]), "deepseek");
    expect(thinkingOf(out).signature).toBe("deepseek-shaped");
  });
});
