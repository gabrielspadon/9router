// #1490 — "Blocked by tool calls when using cursor model composer". Every
// provider whose executor emits OpenAI chunks (cursor's composer/agent path
// among them) can end its stream without a finish_reason: the agent event loop
// closes on an `error` event, or the connection drops. The openai→claude
// translator only produced its terminal (`message_delta` + `message_stop`) from
// the finish_reason branch, so the flush closed the tool_use blocks (#3416) and
// left the MESSAGE open. `data: [DONE]` is not in the Anthropic wire protocol
// and stream.js deliberately withholds it from a Claude client, so nothing else
// was ever going to end the turn and the client waited until its own timeout.
import { describe, expect, it } from 'vitest';

import { openaiToClaudeResponse } from '../../open-sse/translator/response/openai-to-claude.js';
import { initState } from '../../open-sse/translator/index.js';
import { FORMATS } from '../../open-sse/translator/formats.js';

const chunk = (delta, extra = {}) => ({
  id: 'chatcmpl-abc12345',
  model: 'm',
  choices: [{ index: 0, delta, ...extra }],
});

const ARGS = JSON.stringify({ command: 'ls -la' });

const types = (events) => (events || []).map((e) => e.type);

const inputJson = (events) =>
  (events || [])
    .filter((e) => e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta')
    .map((e) => e.delta.partial_json)
    .join('');

function toolStream({ split = false } = {}) {
  const state = initState(FORMATS.CLAUDE);
  openaiToClaudeResponse(chunk({ role: 'assistant', content: 'checking' }), state);
  openaiToClaudeResponse(
    chunk({
      tool_calls: [
        { index: 0, id: 'toolu_1', function: { name: 'Bash', arguments: split ? '' : ARGS } },
      ],
    }),
    state
  );
  if (split) {
    for (const piece of [ARGS.slice(0, 8), ARGS.slice(8)]) {
      openaiToClaudeResponse(
        chunk({ tool_calls: [{ index: 0, function: { arguments: piece } }] }),
        state
      );
    }
  }
  return state;
}

describe('a tool-call stream that ends without finish_reason still ends the Claude message (#1490)', () => {
  it('emits message_delta and message_stop after closing the tool block', () => {
    const flushed = openaiToClaudeResponse(null, toolStream());

    expect(flushed).not.toBeNull();
    expect(types(flushed)).toEqual([
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
    // The terminal reports the reason the turn actually stopped, so the client
    // dispatches the tool instead of treating the turn as a finished answer.
    const delta = flushed.find((e) => e.type === 'message_delta');
    expect(delta.delta.stop_reason).toBe('tool_use');
    expect(delta.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
  });

  it('still delivers the buffered arguments intact (the #3416 contract)', () => {
    const flushed = openaiToClaudeResponse(null, toolStream({ split: true }));
    expect(JSON.parse(inputJson(flushed))).toEqual(JSON.parse(ARGS));
  });

  it('reports the usage the provider did send', () => {
    const state = toolStream();
    openaiToClaudeResponse(
      { ...chunk({}), usage: { prompt_tokens: 120, completion_tokens: 7 } },
      state
    );
    const delta = openaiToClaudeResponse(null, state).find((e) => e.type === 'message_delta');
    expect(delta.usage).toMatchObject({ input_tokens: 120, output_tokens: 7 });
  });

  it('opens, closes and terminates a call whose name never arrived', () => {
    const state = initState(FORMATS.CLAUDE);
    openaiToClaudeResponse(chunk({ role: 'assistant' }), state);
    // id without a name: the block cannot open yet, and the finish_reason branch
    // that would have salvaged it never runs.
    openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, id: 'toolu_2' }] }), state);

    const flushed = openaiToClaudeResponse(null, state);
    expect(types(flushed)).toEqual([
      'content_block_start',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ]);
    expect(flushed[0].content_block).toMatchObject({ type: 'tool_use', id: 'toolu_2' });
  });

  it('does not emit a second terminal when the stream already finished', () => {
    const state = toolStream();
    const finished = openaiToClaudeResponse(chunk({}, { finish_reason: 'tool_calls' }), state);
    expect(types(finished)).toContain('message_stop');
    // Two message_stop events, or a repeated input_json_delta, corrupt the turn.
    expect(openaiToClaudeResponse(null, state)).toBeNull();
  });

  it('leaves a flush with no tool call alone', () => {
    // The existing contract (tool-args-flush-drain-3416): a text-only stream
    // produces nothing at flush. Widening this would need a matching change in
    // stream.js, which is not this fix.
    const state = initState(FORMATS.CLAUDE);
    openaiToClaudeResponse(chunk({ role: 'assistant', content: 'hi' }), state);
    expect(openaiToClaudeResponse(null, state)).toBeNull();
  });
});
