// #1733 — "Received content_block_delta without a current message".
//
// The Claude SSE lifecycle closes the message at message_stop, so every event
// after it has no message to attach to and the client aborts the turn. Both
// emitters that build Claude SSE could produce one: openai-to-claude kept
// opening blocks for any trailing frame a provider sent after its finish_reason
// chunk, and kiro-to-claude had no once-guard on the terminal at all, so a
// repeated finish_reason replayed the buffered tool arguments as deltas after
// message_stop had already gone out.
import { describe, it, expect } from 'vitest';
import { openaiToClaudeResponse } from '../../open-sse/translator/response/openai-to-claude.js';
import { kiroToClaudeResponse } from '../../open-sse/translator/response/kiro-to-claude.js';
import { initState } from '../../open-sse/translator/index.js';
import { FORMATS } from '../../open-sse/translator/formats.js';

const chunk = (delta, finish_reason = null, extra = {}) => ({
  id: 'chatcmpl-abcdefgh',
  model: 'm',
  choices: [{ index: 0, delta, finish_reason }],
  ...extra,
});

// Replay a whole stream and return the flat event list the client would see.
const replay = (translate, chunks) => {
  const state = initState(FORMATS.CLAUDE);
  const events = [];
  for (const c of chunks) {
    const out = translate(c, state);
    if (out) events.push(...out);
  }
  return { events, state };
};

// The invariant the client enforces: nothing may follow message_stop, and no
// content_block_delta may reference a block that was never opened.
const assertWellFormed = (events) => {
  const open = new Set();
  let messageOpen = false;
  for (const e of events) {
    expect(e.type === 'message_start' || messageOpen, `${e.type} before message_start`).toBe(true);
    if (e.type === 'message_start') messageOpen = true;
    if (e.type === 'content_block_start') open.add(e.index);
    if (e.type === 'content_block_delta') {
      expect(open.has(e.index), `content_block_delta on unopened block ${e.index}`).toBe(true);
    }
    if (e.type === 'content_block_stop') open.delete(e.index);
    if (e.type === 'message_stop') messageOpen = false;
  }
};

describe('openai → claude stream terminal (#1733)', () => {
  it('emits nothing after message_stop when a provider sends a trailing content frame', () => {
    const { events } = replay(openaiToClaudeResponse, [
      chunk({ role: 'assistant', content: 'hi' }),
      chunk({}, 'stop'),
      chunk({ content: ' trailing' }),
    ]);

    const stopAt = events.findIndex((e) => e.type === 'message_stop');
    expect(stopAt).toBeGreaterThan(-1);
    expect(events.slice(stopAt + 1)).toEqual([]);
    assertWellFormed(events);
  });

  it('emits nothing after message_stop when the provider repeats finish_reason', () => {
    const { events } = replay(openaiToClaudeResponse, [
      chunk({ role: 'assistant', content: 'hi' }),
      chunk({}, 'stop'),
      chunk({}, 'stop', { usage: { prompt_tokens: 4, completion_tokens: 2 } }),
    ]);

    expect(events.filter((e) => e.type === 'message_stop')).toHaveLength(1);
    assertWellFormed(events);
  });

  it('still emits the normal stream when nothing trails the terminal', () => {
    const { events } = replay(openaiToClaudeResponse, [
      chunk({ role: 'assistant', content: 'hi' }),
      chunk({ content: ' there' }),
      chunk({}, 'stop'),
    ]);

    const text = events
      .filter((e) => e.type === 'content_block_delta' && e.delta?.type === 'text_delta')
      .map((e) => e.delta.text)
      .join('');
    expect(text).toBe('hi there');
    assertWellFormed(events);
  });
});

describe('kiro → claude stream terminal (#1733)', () => {
  const toolChunks = () => [
    chunk({ role: 'assistant', content: 'working' }),
    chunk({ tool_calls: [{ index: 0, id: 't1', function: { name: 'Bash', arguments: '{"a":' } }] }),
    chunk({ tool_calls: [{ index: 0, function: { arguments: '1}' } }] }),
    chunk({}, 'tool_calls'),
  ];

  it('emits nothing after message_stop when finish_reason repeats', () => {
    const { events } = replay(kiroToClaudeResponse, [
      ...toolChunks(),
      chunk({}, 'tool_calls', { usage: { prompt_tokens: 9, completion_tokens: 3 } }),
    ]);

    const stopAt = events.findIndex((e) => e.type === 'message_stop');
    expect(stopAt).toBeGreaterThan(-1);
    expect(events.slice(stopAt + 1)).toEqual([]);
    assertWellFormed(events);
  });

  it('does not replay the buffered tool arguments twice', () => {
    const { events } = replay(kiroToClaudeResponse, [...toolChunks(), chunk({}, 'tool_calls')]);

    const args = events.filter(
      (e) => e.type === 'content_block_delta' && e.delta?.type === 'input_json_delta'
    );
    expect(args).toHaveLength(1);
    expect(args[0].delta.partial_json).toBe('{"a":1}');
  });

  it('still emits a complete single-pass stream', () => {
    const { events } = replay(kiroToClaudeResponse, toolChunks());

    expect(events.filter((e) => e.type === 'message_stop')).toHaveLength(1);
    expect(
      events.some((e) => e.type === 'content_block_start' && e.content_block?.type === 'tool_use')
    ).toBe(true);
    assertWellFormed(events);
  });
});
