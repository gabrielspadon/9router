// #1382 — a turn that is entirely tool calls recorded zero output tokens. The
// tool calls themselves arrived intact; only the counter missed them, because
// totalContentLength was fed by visible text and reasoning alone and the usage
// estimator is gated on it being > 0. Tool-call names and argument fragments
// are model output and are now counted the same way visible text is.
import { describe, expect, it, vi } from "vitest";

import {
  createSSETransformStreamWithLogger,
  createPassthroughStreamWithLogger,
} from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const encoder = new TextEncoder();
const frame = (payload) => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

const ARGS = '{"file_path":"/repo/src/index.js","offset":0,"limit":2000}';

const toolCallFrames = [
  frame({
    choices: [{
      index: 0,
      delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "Read", arguments: "" } }] },
      finish_reason: null,
    }],
  }),
  frame({
    choices: [{
      index: 0,
      delta: { tool_calls: [{ index: 0, function: { arguments: ARGS } }] },
      finish_reason: null,
    }],
  }),
  frame({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
];

const textFrames = [
  frame({ choices: [{ index: 0, delta: { content: "x".repeat(ARGS.length + "Read".length) }, finish_reason: null }] }),
  frame({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
];

const body = { messages: [{ role: "user", content: "read the file" }] };

async function run(stream, frames) {
  const reader = stream.readable.getReader();
  const writer = stream.writable.getWriter();
  const drain = (async () => { for (;;) { const { done } = await reader.read(); if (done) return; } })();
  for (const f of frames) await writer.write(f);
  await writer.close();
  await drain;
}

function translateStream(onStreamComplete) {
  // deepseek's shape from the report: OpenAI-format provider, claude client.
  return createSSETransformStreamWithLogger(
    FORMATS.OPENAI, FORMATS.CLAUDE, "deepseek", null, null,
    "deepseek-chat", "conn-1382", body, onStreamComplete, "sk-test",
  );
}

function passthroughStream(onStreamComplete) {
  return createPassthroughStreamWithLogger(
    "deepseek", null, "deepseek-chat", "conn-1382", body, onStreamComplete, "sk-test", null, null, FORMATS.OPENAI,
  );
}

// The estimator emits usage in the CLIENT's format, so a claude client gets
// output_tokens where an openai one gets completion_tokens.
const outputTokensOf = (fn) => {
  const usage = fn.mock.calls[0][1];
  return Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0);
};
const contentOf = (fn) => fn.mock.calls[0][0];

describe("#1382 a tool-call-only turn records the output tokens it spent", () => {
  it("counts tool-call bytes in translate mode", async () => {
    const onStreamComplete = vi.fn();
    await run(translateStream(onStreamComplete), toolCallFrames);

    expect(onStreamComplete).toHaveBeenCalledTimes(1);
    expect(outputTokensOf(onStreamComplete)).toBeGreaterThan(0);
  });

  it("counts tool-call bytes in passthrough mode", async () => {
    const onStreamComplete = vi.fn();
    await run(passthroughStream(onStreamComplete), toolCallFrames);

    expect(onStreamComplete).toHaveBeenCalledTimes(1);
    expect(outputTokensOf(onStreamComplete)).toBeGreaterThan(0);
  });

  it("counts them the same way as visible text of the same size", async () => {
    const tools = vi.fn();
    const text = vi.fn();
    await run(translateStream(tools), toolCallFrames);
    await run(translateStream(text), textFrames);

    expect(outputTokensOf(tools)).toBeGreaterThan(0);
    expect(outputTokensOf(tools)).toBe(outputTokensOf(text));
  });

  it("leaves the visible transcript empty — this is accounting, not content", async () => {
    const onStreamComplete = vi.fn();
    await run(translateStream(onStreamComplete), toolCallFrames);

    expect(contentOf(onStreamComplete).content).toBe("");
    expect(contentOf(onStreamComplete).thinking).toBe("");
  });

  it("still reports zero for a stream that produced nothing at all", async () => {
    const onStreamComplete = vi.fn();
    await run(translateStream(onStreamComplete), [frame({ choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })]);

    expect(outputTokensOf(onStreamComplete)).toBe(0);
  });
});
