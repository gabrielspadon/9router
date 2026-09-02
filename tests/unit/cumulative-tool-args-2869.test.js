/**
 * Cumulative tool-argument streaming doubled the tool input (#2869).
 *
 * The OpenAI→Claude response translator buffers `tool_calls.function.arguments`
 * per index with a blind `prev + chunk` append. Some OpenAI-compatible
 * providers do not stream argument DELTAS — each chunk restates the whole
 * arguments string accumulated so far. The append then produces
 *
 *     {"command":"ls"}{"command":"ls"}
 *
 * in the single `input_json_delta`, which no Anthropic client can parse
 * ("Invalid tool parameters"). The upstream status is 200, so per-model locking
 * and combo failover never see it and the turn fails silently.
 */
import { describe, expect, it } from "vitest";
import { FORMATS } from "open-sse/translator/formats.js";
import { initState, translateResponse } from "open-sse/translator/index.js";

const ARGS_HEAD = '{"command":"cd /tmp';
const ARGS_FULL = '{"command":"cd /tmp && ls -la"}';

function chunk(extra) {
  return { id: "chatcmpl-1", model: "gpt-x", choices: [{ index: 0, delta: {}, ...extra }] };
}

function toolChunk(fields) {
  return chunk({ delta: { tool_calls: [{ index: 0, ...fields }] } });
}

function run(chunks) {
  const state = initState(FORMATS.CLAUDE);
  const events = [];
  for (const c of chunks) {
    const out = translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, c, state);
    if (out?.length) events.push(...out);
  }
  const flushed = translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, null, state);
  if (flushed?.length) events.push(...flushed);
  return events;
}

const inputJson = (events) =>
  events
    .filter((e) => e.type === "content_block_delta" && e.delta?.type === "input_json_delta")
    .map((e) => e.delta.partial_json);

describe("cumulative tool-argument streaming (#2869)", () => {
  it("replaces the buffer when a chunk restates it, instead of doubling", () => {
    const events = run([
      toolChunk({ id: "call_1", function: { name: "Bash", arguments: ARGS_HEAD } }),
      toolChunk({ function: { arguments: ARGS_FULL } }),
      chunk({ finish_reason: "tool_calls" }),
    ]);

    expect(inputJson(events)).toEqual([ARGS_FULL]);
    expect(() => JSON.parse(inputJson(events)[0])).not.toThrow();
  });

  it("collapses an exact restatement of a complete argument string", () => {
    const events = run([
      toolChunk({ id: "call_1", function: { name: "Bash", arguments: ARGS_FULL } }),
      toolChunk({ function: { arguments: ARGS_FULL } }),
      chunk({ finish_reason: "tool_calls" }),
    ]);

    expect(inputJson(events)).toEqual([ARGS_FULL]);
  });

  it("still appends genuine incremental fragments", () => {
    const events = run([
      toolChunk({ id: "call_1", function: { name: "Bash", arguments: '{"command":"ls' } }),
      toolChunk({ function: { arguments: ' -la"}' } }),
      chunk({ finish_reason: "tool_calls" }),
    ]);

    expect(inputJson(events)).toEqual(['{"command":"ls -la"}']);
  });
});
