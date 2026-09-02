import { describe, it, expect } from "vitest";
import { claudeToOpenAIRequest } from "../../open-sse/translator/request/claude-to-openai.js";
import { geminiToOpenAIRequest } from "../../open-sse/translator/request/gemini-to-openai.js";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { openaiToOllamaRequest } from "../../open-sse/translator/request/openai-to-ollama.js";

// Issue #2400 and its duplicates (#1459 #2690 #2721). Assistant reasoning
// history is carried differently by every format — a Claude thinking block, a
// Gemini part flagged thought:true, an OpenAI reasoning_content field, an
// Ollama thinking field — and the request translators dropped it crossing
// between them. A multi-turn conversation therefore lost the model's own prior
// reasoning at every hop, which is what the reporters saw as the model
// forgetting what it had already worked out.

const assistantOf = (msgs) => msgs.filter((m) => m.role === "assistant");

describe("assistant reasoning survives the request pivot (#2400)", () => {
  it("claude thinking block becomes openai reasoning_content", () => {
    const out = claudeToOpenAIRequest("gpt-5", {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: [
          { type: "thinking", thinking: "weigh the options", signature: "sig" },
          { type: "text", text: "here" },
        ] },
      ],
    }, true);

    const [a] = assistantOf(out.messages);
    expect(a.reasoning_content).toBe("weigh the options");
    expect(a.content).toContain("here");
  });

  it("a claude turn that is only thinking is not dropped", () => {
    const out = claudeToOpenAIRequest("gpt-5", {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: [{ type: "thinking", thinking: "still working", signature: "sig" }] },
      ],
    }, true);

    const [a] = assistantOf(out.messages);
    expect(a.reasoning_content).toBe("still working");
  });

  it("gemini thought parts do not leak into visible content", () => {
    const out = geminiToOpenAIRequest("gpt-5", {
      contents: [
        { role: "user", parts: [{ text: "hi" }] },
        { role: "model", parts: [{ text: "internal", thought: true }, { text: "answer" }] },
      ],
    }, true);

    const [a] = assistantOf(out.messages);
    expect(a.reasoning_content).toBe("internal");
    const visible = typeof a.content === "string" ? a.content : JSON.stringify(a.content);
    expect(visible).toContain("answer");
    expect(visible).not.toContain("internal");
  });

  it("openai reasoning_content becomes a leading claude thinking block", () => {
    const out = openaiToClaudeRequest("claude-sonnet-4.5", {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "answer", reasoning_content: "weighed it" },
      ],
    }, true);

    const [a] = assistantOf(out.messages);
    expect(Array.isArray(a.content)).toBe(true);
    expect(a.content[0].type).toBe("thinking");
    expect(a.content[0].thinking).toBe("weighed it");
    expect(a.content[0].signature).toBeTruthy();
  });

  it("does not duplicate a thinking block the caller already sent", () => {
    const out = openaiToClaudeRequest("claude-sonnet-4.5", {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", reasoning_content: "weighed it", content: [
          { type: "thinking", thinking: "weighed it", signature: "sig" },
          { type: "text", text: "answer" },
        ] },
      ],
    }, true);

    const [a] = assistantOf(out.messages);
    expect(a.content.filter((b) => b.type === "thinking")).toHaveLength(1);
  });

  it("openai reasoning_content becomes the ollama thinking field", () => {
    const out = openaiToOllamaRequest("qwen3", {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "answer", reasoning_content: "weighed it" },
      ],
    }, true);

    const [a] = assistantOf(out.messages);
    expect(a.thinking).toBe("weighed it");
    expect(a.content).toBe("answer");
  });

  it("keeps reasoning on an ollama assistant turn that also calls a tool", () => {
    const out = openaiToOllamaRequest("qwen3", {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "", reasoning: "pick the tool",
          tool_calls: [{ id: "1", function: { name: "lookup", arguments: "{}" } }] },
      ],
    }, true);

    const [a] = assistantOf(out.messages);
    expect(a.thinking).toBe("pick the tool");
    expect(a.tool_calls[0].function.name).toBe("lookup");
  });
});
