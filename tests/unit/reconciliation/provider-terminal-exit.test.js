// provider.terminal.exit — managed response finalizer equivalent.
//
// boundary-contract.json "provider.terminal.exit": exactly one terminal event
// and complete accounting per generation. Exercised against
// openaiToClaudeResponse (open-sse/translator/response/openai-to-claude.js),
// the managed response finalizer for every OpenAI-shaped provider stream
// translated to a Claude-format client.
import { describe, it, expect } from "vitest";
import { openaiToClaudeResponse } from "open-sse/translator/response/openai-to-claude.js";

function createState() {
  return { toolCalls: new Map(), nextBlockIndex: 0 };
}

const MODEL = "test-terminal-model";
const MSG_ID = "chatcmpl-provider-terminal-exit";

function push(state, events, chunk) {
  const r = openaiToClaudeResponse(chunk, state);
  if (r) events.push(...r);
  return r;
}

const terminals = (events) => events.filter((e) => e.type === "message_stop");

describe('provider.terminal.exit: "settle twice" — a repeated upstream terminal never re-fires', () => {
  it("a second finish_reason chunk after the first produces no further output at all", () => {
    const state = createState();
    const events = [];
    push(state, events, { id: MSG_ID, model: MODEL, choices: [{ delta: { role: "assistant", content: "hi" } }] });
    push(state, events, { id: MSG_ID, model: MODEL, choices: [{ delta: {}, finish_reason: "stop" }] });
    expect(terminals(events)).toHaveLength(1);

    // A misbehaving upstream repeats its own terminal chunk.
    const second = push(state, events, { id: MSG_ID, model: MODEL, choices: [{ delta: {}, finish_reason: "stop" }] });
    expect(second).toBeNull();
    expect(terminals(events)).toHaveLength(1); // still exactly one, never two
  });
});

describe('provider.terminal.exit: "lose usage-only frame" — a deferred terminal is released by the usage-only frame, with the real counts', () => {
  it("the terminal waits for stream_options.include_usage, then fires on the usage-only frame carrying the real tokens", () => {
    const state = createState();
    const events = [];
    push(state, events, { id: MSG_ID, model: MODEL, choices: [{ delta: { role: "assistant", content: "hi" } }] });

    // Finish chunk explicitly promises usage in a trailing frame (usage: null).
    push(state, events, { id: MSG_ID, model: MODEL, choices: [{ delta: {}, finish_reason: "stop" }], usage: null });
    expect(terminals(events)).toHaveLength(0); // withheld correctly, not lost and not fired early

    // Usage-only frame: empty choices, the real token counts.
    push(state, events, { id: MSG_ID, model: MODEL, choices: [], usage: { prompt_tokens: 321, completion_tokens: 64 } });

    expect(terminals(events)).toHaveLength(1); // exactly one terminal, released by the usage frame
    const delta = events.find((e) => e.type === "message_delta");
    expect(delta.usage.input_tokens).toBe(321);
    expect(delta.usage.output_tokens).toBe(64);
  });
});

describe('provider.terminal.exit: "accept missing terminal" — the flush synthesizes exactly one terminal when the upstream never sends finish_reason', () => {
  it("a tool call left open by a dropped connection still closes with one terminal at flush", () => {
    const state = createState();
    const events = [];
    push(state, events, { id: MSG_ID, model: MODEL, choices: [{ delta: { role: "assistant" } }] });
    push(state, events, {
      id: MSG_ID,
      model: MODEL,
      choices: [{ delta: { tool_calls: [{ index: 0, id: "toolu_missing", function: { name: "Bash", arguments: '{"command":"ls"}' } }] } }],
    });
    // Upstream closes without ever sending a finish_reason chunk.
    push(state, events, null);

    expect(terminals(events)).toHaveLength(1); // exactly one terminal — the client is never left hanging
    const stops = events.filter((e) => e.type === "content_block_stop");
    expect(stops.length).toBeGreaterThan(0); // the open tool block was closed too, not abandoned
  });

  it("calling the flush a second time after a tool-call terminal is a no-op, not a second terminal", () => {
    const state = createState();
    const events = [];
    push(state, events, { id: MSG_ID, model: MODEL, choices: [{ delta: { role: "assistant" } }] });
    push(state, events, {
      id: MSG_ID,
      model: MODEL,
      choices: [{ delta: { tool_calls: [{ index: 0, id: "toolu_x", function: { name: "Bash", arguments: '{"command":"ls"}' } }] } }],
    });
    push(state, events, null); // first flush — synthesizes the terminal
    expect(terminals(events)).toHaveLength(1);

    const again = push(state, events, null); // second flush — must be a no-op
    expect(again).toBeNull();
    expect(terminals(events)).toHaveLength(1);
  });
});
