import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openaiToAntigravityResponse } from '../../open-sse/translator/response/openai-to-antigravity.js';

/**
 * #2431 — "Antigravity to Antigravity MITM ResponseAborted": the reporter
 * hits it specifically when an agent writes something big (a long
 * implementation plan). The tool-call branch here accumulates every OpenAI
 * delta.tool_calls fragment silently and returns null until finish_reason
 * arrives, because a Gemini/Antigravity functionCall part has to carry
 * complete, parseable JSON args and can't stream partially. For a large
 * write-file argument that accumulation can run well past a minute with
 * zero bytes reaching the client on this leg of the MITM pivot, and the
 * observed abort timestamps (~130s, twice) land far under any of this
 * project's own stream/stall timeouts (200s TTFT, 360s stall) — so
 * something outside this repo's timers is severing the idle connection.
 * A throttled heartbeat during accumulation keeps bytes flowing without
 * touching the eventual functionCall payload.
 */
describe('openaiToAntigravityResponse tool-call heartbeat (#2431)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function toolCallChunk(argsFragment, { id, name } = {}) {
    return {
      id: 'chatcmpl-1',
      model: 'gemini-3-flash',
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id,
                function: { name, arguments: argsFragment },
              },
            ],
          },
        },
      ],
    };
  }

  it('stays silent immediately after the first tool-call fragment', () => {
    const state = {};
    const out = openaiToAntigravityResponse(
      toolCallChunk('{"path":"plan.md","content":"', { id: 'call_1', name: 'write_file' }),
      state
    );
    expect(out).toBeNull();
  });

  it('emits a heartbeat once accumulation has run long enough, without leaking a functionCall', () => {
    const state = {};
    openaiToAntigravityResponse(
      toolCallChunk('{"path":"plan.md","content":"', { id: 'call_1', name: 'write_file' }),
      state
    );

    vi.advanceTimersByTime(8001);
    const out = openaiToAntigravityResponse(toolCallChunk('a lot more plan text '), state);

    expect(out).not.toBeNull();
    const parts = out.response.candidates[0].content.parts;
    expect(parts).toEqual([{ text: '' }]);
    // Heartbeat must not surface as a premature (and therefore malformed) tool call.
    expect(parts.some((p) => p.functionCall)).toBe(false);
    expect(out.response.candidates[0].finishReason).toBeUndefined();
  });

  it('does not spam a second heartbeat before the interval elapses again', () => {
    const state = {};
    openaiToAntigravityResponse(
      toolCallChunk('{"content":"', { id: 'call_1', name: 'write_file' }),
      state
    );
    vi.advanceTimersByTime(8001);
    openaiToAntigravityResponse(toolCallChunk('chunk one '), state); // heartbeat #1

    const immediate = openaiToAntigravityResponse(toolCallChunk('chunk two '), state);
    expect(immediate).toBeNull();

    vi.advanceTimersByTime(8001);
    const second = openaiToAntigravityResponse(toolCallChunk('chunk three '), state);
    expect(second).not.toBeNull();
    expect(second.response.candidates[0].content.parts).toEqual([{ text: '' }]);
  });

  it('still assembles the correct functionCall at finish despite interleaved heartbeats', () => {
    const state = {};
    openaiToAntigravityResponse(
      toolCallChunk('{"path":"plan.md",', { id: 'call_1', name: 'write_file' }),
      state
    );
    vi.advanceTimersByTime(8001);
    openaiToAntigravityResponse(toolCallChunk('"content":"hello'), state); // heartbeat
    openaiToAntigravityResponse(toolCallChunk(' world"}'), state);

    const finishChunk = {
      id: 'chatcmpl-1',
      model: 'gemini-3-flash',
      choices: [{ delta: {}, finish_reason: 'tool_calls' }],
    };
    const out = openaiToAntigravityResponse(finishChunk, state);

    expect(out).not.toBeNull();
    const parts = out.response.candidates[0].content.parts;
    expect(parts).toEqual([
      { functionCall: { name: 'write_file', args: { path: 'plan.md', content: 'hello world' } } },
    ]);
  });

  it('never heartbeats a short tool call that finishes before the interval elapses', () => {
    const state = {};
    openaiToAntigravityResponse(
      toolCallChunk('{"path":"x"}', { id: 'call_1', name: 'write_file' }),
      state
    );
    vi.advanceTimersByTime(50);

    const finishChunk = {
      id: 'chatcmpl-1',
      model: 'gemini-3-flash',
      choices: [{ delta: {}, finish_reason: 'tool_calls' }],
    };
    const out = openaiToAntigravityResponse(finishChunk, state);
    expect(out.response.candidates[0].content.parts).toEqual([
      { functionCall: { name: 'write_file', args: { path: 'x' } } },
    ]);
  });
});
