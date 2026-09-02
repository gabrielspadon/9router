import { describe, expect, it } from "vitest";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";
import { initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Tool arguments are buffered per index and emitted as one input_json_delta by
// the finish_reason branch. A stream that ends WITHOUT a finish_reason — an
// upstream that sends [DONE] with no finish chunk, or a dropped connection —
// left the whole buffer in the map and the tool_use block open, so the client
// kept a tool call whose input never arrived and was never closed. That is the
// "cut off ... and never closed" shape reported in #3416. stream.js flushes the
// translator with a null chunk, which is where the block can still be closed.
const chunk = (delta, extra = {}) => ({
  id: "chatcmpl-abc12345",
  model: "m",
  choices: [{ index: 0, delta, ...extra }],
});

const ARGS = JSON.stringify({
  command: 'ls docs/ 2>/dev/null | grep -iE "118|quota" ; echo "---" ; grep -rl "118" docs/',
});

function runToolStream() {
  const state = initState(FORMATS.CLAUDE);
  openaiToClaudeResponse(chunk({ role: "assistant" }), state);
  openaiToClaudeResponse(
    chunk({ tool_calls: [{ index: 0, id: "toolu_1", function: { name: "Bash", arguments: "" } }] }),
    state,
  );
  // Split the argument JSON the way a provider streams it.
  for (const piece of [ARGS.slice(0, 20), ARGS.slice(20, 60), ARGS.slice(60)]) {
    openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, function: { arguments: piece } }] }), state);
  }
  return state;
}

const inputJson = (events) =>
  (events || [])
    .filter((e) => e.type === "content_block_delta" && e.delta?.type === "input_json_delta")
    .map((e) => e.delta.partial_json)
    .join("");

describe("tool arguments survive a stream that ends without finish_reason (#3416)", () => {
  it("emits the whole buffered input and closes the block on flush", () => {
    const state = runToolStream();
    const flushed = openaiToClaudeResponse(null, state);

    expect(flushed).not.toBeNull();
    const json = inputJson(flushed);
    expect(json).not.toBe("");
    expect(() => JSON.parse(json)).not.toThrow();
    expect(JSON.parse(json)).toEqual(JSON.parse(ARGS));
    expect(flushed.some((e) => e.type === "content_block_stop")).toBe(true);
  });

  it("does not re-emit when the stream already reached its terminal", () => {
    const state = runToolStream();
    const finished = openaiToClaudeResponse(chunk({}, { finish_reason: "tool_calls" }), state);
    expect(JSON.parse(inputJson(finished))).toEqual(JSON.parse(ARGS));

    // The flush must not repeat the payload — two input_json_delta runs
    // concatenate at the client into {...}{...}, which is not parseable.
    expect(inputJson(openaiToClaudeResponse(null, state))).toBe("");
  });

  it("stays null on a flush with no tool call open", () => {
    const state = initState(FORMATS.CLAUDE);
    openaiToClaudeResponse(chunk({ role: "assistant", content: "hi" }), state);
    expect(openaiToClaudeResponse(null, state)).toBeNull();
  });
});
