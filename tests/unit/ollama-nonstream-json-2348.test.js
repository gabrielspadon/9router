import { describe, it, expect } from "vitest";
import { transformToOllama } from "../../open-sse/utils/ollamaTransform.js";

// /api/chat with stream:false never yields SSE — the chat handler returns a plain
// Chat Completions object (application/json). The NDJSON line reader ignores any
// line that is not `data:`, so the answer, its tool calls, its usage and even a
// non-200 status were all dropped and the client got one empty done message
// (#2348, the Ollama half of the forced-SSE/non-stream projection residual).
function jsonUpstream(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const completion = (message, extra = {}) => ({
  id: "chatcmpl-1",
  choices: [{ index: 0, message, finish_reason: extra.finish_reason || "stop" }],
  ...(extra.usage ? { usage: extra.usage } : {}),
});

describe("Ollama-compatible non-streaming JSON projection", () => {
  it("returns the assistant answer instead of an empty done message", async () => {
    const res = await transformToOllama(
      jsonUpstream(completion({ role: "assistant", content: "hello world" }, {
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      })),
      "llama3.2",
    );
    const out = await res.json();

    expect(out.model).toBe("llama3.2");
    expect(out.message.content).toBe("hello world");
    expect(out.done).toBe(true);
    expect(out.done_reason).toBe("stop");
    expect(out.prompt_eval_count).toBe(5);
    expect(out.eval_count).toBe(2);
  });

  it("carries tool calls through with parsed arguments", async () => {
    const res = await transformToOllama(
      jsonUpstream(completion({
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "get_weather", arguments: '{"city":"Hanoi"}' },
        }],
      }, { finish_reason: "tool_calls" })),
      "llama3.2",
    );
    const out = await res.json();

    expect(out.message.tool_calls).toEqual([
      { function: { name: "get_weather", arguments: { city: "Hanoi" } } },
    ]);
    expect(out.done_reason).toBe("tool_calls");
  });

  it("keeps an upstream error body and its status instead of a 200 empty answer", async () => {
    const res = await transformToOllama(
      jsonUpstream({ error: { message: "rate limited", type: "rate_limit_error" } }, 429),
      "llama3.2",
    );

    expect(res.status).toBe(429);
    expect((await res.json()).error.message).toBe("rate limited");
  });

  it("still streams an SSE upstream as NDJSON", async () => {
    const sse = new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n'));
          c.enqueue(new TextEncoder().encode("data: [DONE]\n"));
          c.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
    const res = await transformToOllama(sse, "m");

    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    const lines = (await res.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
    expect(lines[0].message.content).toBe("hi");
  });
});
