// provider.stream.entry — writeManagedFrame equivalent.
//
// boundary-contract.json "provider.stream.entry": a managed stream must emit
// the message-start ("prompt") frame, real content, and exactly one valid,
// parseable tool call — never a raw echo of a malformed frame, never a
// duplicated tool-call fragment, and never withheld until the whole upstream
// stream has buffered. Exercised against openaiToClaudeResponse, the function
// every OpenAI-shaped provider stream is translated through before it reaches
// a Claude-format client (open-sse/translator/response/openai-to-claude.js).
import { describe, it, expect } from "vitest";
import { openaiToClaudeResponse } from "open-sse/translator/response/openai-to-claude.js";

function createState() {
  return { toolCalls: new Map(), nextBlockIndex: 0 };
}

const MODEL = "test-managed-model";
const MSG_ID = "chatcmpl-provider-stream-entry";

function roleChunk() {
  return { id: MSG_ID, model: MODEL, choices: [{ delta: { role: "assistant" } }] };
}
function contentChunk(text) {
  return { id: MSG_ID, model: MODEL, choices: [{ delta: { content: text } }] };
}
function toolFragmentChunk(index, patch) {
  return { id: MSG_ID, model: MODEL, choices: [{ delta: { tool_calls: [{ index, ...patch }] } }] };
}
function finishChunk(reason) {
  return { id: MSG_ID, model: MODEL, choices: [{ delta: {}, finish_reason: reason }] };
}

describe("provider.stream.entry — a managed stream emits prompt, first content, one valid tool call", () => {
  it("sends message_start (the prompt frame) before any content or tool block", () => {
    const state = createState();
    const events = openaiToClaudeResponse(roleChunk(), state);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message_start");
    expect(events[0].message.model).toBe(MODEL);
    expect(events[0].message.role).toBe("assistant");
  });

  it("emits the first real content chunk on its own call — never withheld until the stream buffers whole", () => {
    const state = createState();
    openaiToClaudeResponse(roleChunk(), state);
    // A single content delta must produce output from THIS call alone: proof
    // nothing is held back until the whole upstream stream has been read (the
    // "buffer complete stream" mutation this guards against).
    const events = openaiToClaudeResponse(contentChunk("Hello"), state);
    expect(events).not.toBeNull();
    const delta = events.find((e) => e.type === "content_block_delta" && e.delta?.type === "text_delta");
    expect(delta.delta.text).toBe("Hello");
  });

  it("assembles tool-call fragments split across many chunks into exactly one valid call — never duplicated", () => {
    const state = createState();
    const events = [];
    const push = (chunk) => {
      const r = openaiToClaudeResponse(chunk, state);
      if (r) events.push(...r);
    };

    push(roleChunk());
    // id and name split across chunks, exactly as GLM/fireworks streams them —
    // the block must wait for both, never open on the id alone.
    push(toolFragmentChunk(0, { id: "toolu_1" }));
    push(toolFragmentChunk(0, { function: { name: "Read" } }));
    // Argument JSON fragmented across two further chunks.
    push(toolFragmentChunk(0, { function: { arguments: '{"file_path":' } }));
    push(toolFragmentChunk(0, { function: { arguments: '"a.js"}' } }));
    push(finishChunk("tool_calls"));

    const opens = events.filter((e) => e.type === "content_block_start" && e.content_block?.type === "tool_use");
    expect(opens).toHaveLength(1); // exactly one tool_use block opened — never duplicated
    expect(opens[0].content_block.name).toBe("Read");
    expect(opens[0].content_block.id).toBe("toolu_1");

    const stops = events.filter((e) => e.type === "content_block_stop" && e.index === opens[0].index);
    expect(stops).toHaveLength(1);

    const argDeltas = events.filter((e) => e.type === "content_block_delta" && e.delta?.type === "input_json_delta");
    expect(argDeltas).toHaveLength(1); // args flush once, as a single valid delta, at the block's close
    expect(JSON.parse(argDeltas[0].delta.partial_json)).toEqual({ file_path: "a.js" });
  });

  it("a provider that RESTATES the accumulated argument string each chunk still yields one valid call, not a doubled payload", () => {
    // Not every upstream streams argument DELTAS — some restate the whole
    // accumulated string in every chunk. A blind append would yield `{...}{...}`,
    // which is the literal shape of a duplicated tool fragment: the same
    // content re-arriving is wrongly treated as new bytes to append.
    const state = createState();
    const events = [];
    const push = (chunk) => {
      const r = openaiToClaudeResponse(chunk, state);
      if (r) events.push(...r);
    };

    push(roleChunk());
    push(toolFragmentChunk(0, { id: "toolu_2", function: { name: "Bash" } }));
    push(toolFragmentChunk(0, { function: { arguments: '{"command":"ls' } }));
    push(toolFragmentChunk(0, { function: { arguments: '{"command":"ls -la"}' } })); // full restatement
    push(finishChunk("tool_calls"));

    const argDeltas = events.filter((e) => e.type === "content_block_delta" && e.delta?.type === "input_json_delta");
    expect(argDeltas).toHaveLength(1);
    expect(JSON.parse(argDeltas[0].delta.partial_json)).toEqual({ command: "ls -la" });
  });

  it("a chunk with no recognizable delta shape produces no output — never a raw echo of a malformed frame", () => {
    const state = createState();
    openaiToClaudeResponse(roleChunk(), state);
    expect(openaiToClaudeResponse({ id: MSG_ID, model: MODEL, choices: [{ delta: {} }] }, state)).toBeNull();
    expect(
      openaiToClaudeResponse({ id: MSG_ID, model: MODEL, choices: [{ delta: { tool_calls: [{ index: 9 }] } }] }, state),
    ).toBeNull();
  });
});
