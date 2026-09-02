import { afterEach, describe, expect, it, vi } from "vitest";
import { claudeToOpenAIResponse } from "open-sse/translator/response/claude-to-openai.js";

const freshState = () => ({ toolCalls: new Map(), serverToolBlockIndex: -1 });

const start = (index, id, name) => ({
  type: "content_block_start",
  index,
  content_block: { type: "tool_use", id, name },
});
const argDelta = (index, partial_json) => ({
  type: "content_block_delta",
  index,
  delta: { type: "input_json_delta", partial_json },
});
const stop = (index) => ({ type: "content_block_stop", index });
const messageStart = () => ({ type: "message_start", message: { id: "msg_1", model: "claude-sonnet-5" } });

const toolCallsIn = (results) =>
  (results || []).flatMap((r) => r.choices?.[0]?.delta?.tool_calls || []);

afterEach(() => vi.restoreAllMocks());

// Tool arguments arrive as streamed fragments and are reassembled per call. A
// client keys the fragments by the OpenAI `index`, so two live calls must never
// share one (#2868).
describe("streamed tool-call arguments stay separated (#2868)", () => {
  it("gives each call its own index within one message", () => {
    const state = freshState();
    claudeToOpenAIResponse(messageStart(), state);
    const a = toolCallsIn(claudeToOpenAIResponse(start(1, "toolu_a", "read_file"), state));
    const b = toolCallsIn(claudeToOpenAIResponse(start(2, "toolu_b", "read_file"), state));
    expect(a[0].index).toBe(0);
    expect(b[0].index).toBe(1);
  });

  it("a second message does not reuse the first message's indices while its calls are still mapped", () => {
    const state = freshState();
    claudeToOpenAIResponse(messageStart(), state);
    claudeToOpenAIResponse(start(1, "toolu_a", "read_file"), state);
    claudeToOpenAIResponse(argDelta(1, '{"path":"main.py","start_line":1440,"end_line":1500}'), state);

    // The counter used to restart at 0 while the map still held block 1, so a
    // new call could be emitted under an index the client was still filling.
    claudeToOpenAIResponse(messageStart(), state);
    expect(state.toolCalls.size).toBe(0);

    const next = toolCallsIn(claudeToOpenAIResponse(start(1, "toolu_c", "read_file"), state));
    expect(next[0].index).toBe(0);
    expect(next[0].id).toBe("toolu_c");
    // and the stale entry cannot receive the new call's fragments
    claudeToOpenAIResponse(argDelta(1, '{"path":"other.py"}'), state);
    expect(state.toolCalls.get(1).function.arguments).toBe('{"path":"other.py"}');
  });

  it("fragments accumulate into the exact original argument string", () => {
    const state = freshState();
    claudeToOpenAIResponse(messageStart(), state);
    claudeToOpenAIResponse(start(1, "toolu_a", "read_file"), state);
    for (const frag of ['{"path":"m', 'ain.py","start_l', 'ine":1440,"end_line":1500}'])
      claudeToOpenAIResponse(argDelta(1, frag), state);
    expect(JSON.parse(state.toolCalls.get(1).function.arguments))
      .toEqual({ path: "main.py", start_line: 1440, end_line: 1500 });
  });
});

describe("a call whose arguments did not reassemble is reported (#2868)", () => {
  it("warns, naming the tool, when the accumulated arguments are not JSON", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = freshState();
    claudeToOpenAIResponse(messageStart(), state);
    claudeToOpenAIResponse(start(1, "toolu_a", "read_file"), state);
    claudeToOpenAIResponse(argDelta(1, '{"path":"main.py","start_line":1440'), state);
    claudeToOpenAIResponse(stop(1), state);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("read_file");
  });

  it("stays quiet on a call that reassembled correctly", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = freshState();
    claudeToOpenAIResponse(messageStart(), state);
    claudeToOpenAIResponse(start(1, "toolu_a", "read_file"), state);
    claudeToOpenAIResponse(argDelta(1, '{"path":"main.py","start_line":1440,"end_line":1500}'), state);
    claudeToOpenAIResponse(stop(1), state);
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays quiet on a tool call that carried no arguments at all", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = freshState();
    claudeToOpenAIResponse(messageStart(), state);
    claudeToOpenAIResponse(start(1, "toolu_a", "list_files"), state);
    claudeToOpenAIResponse(stop(1), state);
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn for a text block that happens to share the stop path", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = freshState();
    claudeToOpenAIResponse(messageStart(), state);
    claudeToOpenAIResponse({ type: "content_block_start", index: 0, content_block: { type: "text" } }, state);
    claudeToOpenAIResponse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } }, state);
    claudeToOpenAIResponse(stop(0), state);
    expect(warn).not.toHaveBeenCalled();
  });
});
