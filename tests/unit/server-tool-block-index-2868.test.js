import { describe, expect, it } from 'vitest';
import { claudeToOpenAIResponse } from 'open-sse/translator/response/claude-to-openai.js';

// Production state arrives from chatCore without serverToolBlockIndex, so the
// fresh state here deliberately omits it too.
const freshState = () => ({ toolCalls: new Map() });

const messageStart = () => ({
  type: 'message_start',
  message: { id: 'msg_1', model: 'claude-sonnet-5' },
});
const serverToolStart = (index) => ({
  type: 'content_block_start',
  index,
  content_block: { type: 'server_tool_use', id: 'srvtoolu_a', name: 'web_search' },
});
const toolStart = (index, id, name) => ({
  type: 'content_block_start',
  index,
  content_block: { type: 'tool_use', id, name },
});
const argDelta = (index, partial_json) => ({
  type: 'content_block_delta',
  index,
  delta: { type: 'input_json_delta', partial_json },
});
const stop = (index) => ({ type: 'content_block_stop', index });

const toolCallsIn = (results) =>
  (results || []).flatMap((r) => r.choices?.[0]?.delta?.tool_calls || []);

// A server_tool_use block parks its index in state so its own deltas are
// dropped rather than forwarded. Block indices restart at 0 on the next
// message, so that parked index has to be released with the rest of the tool
// bookkeeping — otherwise it swallows a real tool call's arguments (#2868).
describe('a stale server tool block index does not swallow a real call (#2868)', () => {
  it('releases the parked index when a new message starts', () => {
    const state = freshState();
    claudeToOpenAIResponse(messageStart(), state);
    // Web search opens at block 1 and the stream ends before its stop arrives.
    claudeToOpenAIResponse(serverToolStart(1), state);
    expect(state.serverToolBlockIndex).toBe(1);

    claudeToOpenAIResponse(messageStart(), state);
    expect(state.serverToolBlockIndex).toBe(-1);
  });

  it('forwards the arguments of a tool_use landing on the previously parked index', () => {
    const state = freshState();
    claudeToOpenAIResponse(messageStart(), state);
    claudeToOpenAIResponse(serverToolStart(1), state);

    claudeToOpenAIResponse(messageStart(), state);
    const opened = toolCallsIn(claudeToOpenAIResponse(toolStart(1, 'toolu_a', 'read_file'), state));
    expect(opened[0].id).toBe('toolu_a');

    const args = '{"path":"main.py","start_line":1440,"end_line":1500}';
    const emitted = toolCallsIn(claudeToOpenAIResponse(argDelta(1, args), state));
    // Without the release the delta is skipped entirely: the client keeps the
    // opening chunk and the call arrives with empty arguments.
    expect(emitted).toHaveLength(1);
    expect(emitted[0].function.arguments).toBe(args);
    expect(JSON.parse(state.toolCalls.get(1).function.arguments)).toEqual({
      path: 'main.py',
      start_line: 1440,
      end_line: 1500,
    });
  });

  it("still drops the server tool block's own deltas within its message", () => {
    const state = freshState();
    claudeToOpenAIResponse(messageStart(), state);
    claudeToOpenAIResponse(serverToolStart(1), state);
    expect(claudeToOpenAIResponse(argDelta(1, '{"query":"weather"}'), state)).toBeNull();
    claudeToOpenAIResponse(stop(1), state);
    expect(state.serverToolBlockIndex).toBe(-1);
  });
});
