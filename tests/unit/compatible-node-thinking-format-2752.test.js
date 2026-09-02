import { describe, expect, it } from "vitest";
import { applyThinking } from "open-sse/translator/concerns/thinkingUnified.js";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";

const NODE = "openai-compatible-chat-limitrouter";

// A user pointing an openai-compatible node at a gateway serving "qwen3.7-plus"
// got the qwen NATIVE fields — enable_thinking and thinking_budget — because
// capability lookup keys on the model name and the node has no registry entry to
// say otherwise. A strict OpenAI gateway answers 400 on both (#2752).
describe("an openai-compatible node gets OpenAI thinking fields (#2752)", () => {
  it("no qwen-native fields are emitted for a qwen-looking model", () => {
    const body = {};
    applyThinking("openai", "qwen3.7-plus(high)", body, NODE);
    expect(body).not.toHaveProperty("enable_thinking");
    expect(body).not.toHaveProperty("thinking_budget");
  });

  it("the OpenAI field is emitted instead", () => {
    const body = {};
    applyThinking("openai", "qwen3.7-plus(high)", body, NODE);
    expect(body.reasoning_effort).toBe("high");
  });

  it("its level set is OpenAI's too", () => {
    const levels = getThinkingLevels(NODE, "qwen3.7-plus");
    expect(levels).toContain("high");
    expect(levels).toContain("minimal");
  });

  it("the direct qwen provider still gets its native fields", () => {
    // The fix is scoped to the compatible wire; it must not change the provider
    // whose API actually takes those fields.
    const body = {};
    applyThinking("openai", "qwen3.7-plus(high)", body, "qwen");
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("a registry provider with its own declared format still wins", () => {
    // Provider override stays ahead of the compatible-node rule in precedence.
    const body = {};
    applyThinking("openai", "@cf/moonshotai/kimi-k2.6(high)", body, "cloudflare-ai");
    expect(body.reasoning_effort).toBe("high");
  });

  it("an anthropic-compatible node is not affected", () => {
    // Different wire; only the openai-compatible prefix is claimed here.
    const levels = getThinkingLevels("anthropic-compatible-chat-x", "claude-sonnet-4.5");
    expect(levels).not.toContain("minimal");
  });
});
