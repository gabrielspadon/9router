import { describe, expect, it } from "vitest";
import { ollamaToOpenAIResponse } from "../../open-sse/translator/response/ollama-to-openai.js";

// Issue #2694. Ollama's /api/chat does not reserve the done:true object for
// bookkeeping — it delivers the last content token inside it. The translator
// used to build the terminal chunk with an empty delta and return, so that
// token never reached the client and never reached the request log.

function emit(chunk, state) {
  const out = ollamaToOpenAIResponse(chunk, state);
  if (!out) return [];
  return Array.isArray(out) ? out : [out];
}

function textOf(chunks) {
  return chunks.map((c) => c.choices[0].delta.content || "").join("");
}

describe("ollama stream translator, final chunk", () => {
  it("keeps content that arrives in the same object as done:true", () => {
    const state = {};
    const chunks = [
      ...emit({ model: "m", message: { role: "assistant", content: "Hello" }, done: false }, state),
      ...emit({ model: "m", message: { role: "assistant", content: "!" }, done: true, done_reason: "stop" }, state),
    ];

    expect(textOf(chunks)).toBe("Hello!");
    expect(state.accumulatedContent).toBe("Hello!");
  });

  it("closes the stream with finish_reason and usage on the last chunk", () => {
    const state = {};
    const chunks = emit(
      { model: "m", message: { content: "!" }, done: true, done_reason: "stop", prompt_eval_count: 3, eval_count: 4 },
      state,
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0].choices[0].finish_reason).toBeNull();
    expect(chunks[0].choices[0].delta.content).toBe("!");

    const last = chunks[1];
    expect(last.choices[0].delta).toEqual({});
    expect(last.choices[0].finish_reason).toBe("stop");
    expect(last.usage).toBeTruthy();
  });

  it("still emits a single terminal chunk when the final object carries no content", () => {
    const state = {};
    const chunks = emit({ model: "m", done: true, done_reason: "stop" }, state);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].choices[0].delta).toEqual({});
    expect(chunks[0].choices[0].finish_reason).toBe("stop");
  });

  it("reports tool_calls that arrive only in the final object", () => {
    const state = {};
    const chunks = emit(
      {
        model: "m",
        message: { tool_calls: [{ function: { name: "lookup", arguments: { q: "x" } } }] },
        done: true,
        done_reason: "stop",
      },
      state,
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0].choices[0].delta.tool_calls[0].function.name).toBe("lookup");
    expect(chunks[1].choices[0].finish_reason).toBe("tool_calls");
  });

  it("accumulates thinking from the final object", () => {
    const state = {};
    emit({ model: "m", message: { thinking: "because" }, done: true, done_reason: "stop" }, state);
    expect(state.accumulatedThinking).toBe("because");
  });
});
