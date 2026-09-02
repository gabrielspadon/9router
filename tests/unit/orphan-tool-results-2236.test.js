// #2236 — an orphaned or duplicated tool result was carried to the upstream
// verbatim (OpenAI, Claude) or dropped on the floor (Gemini), depending only on
// which translator happened to run. History truncation and context compaction
// produce them routinely, so the repair belongs in the one place every request
// format passes through rather than in each translator.
import { describe, it, expect } from 'vitest';
import { repairOrphanToolResults } from '../../open-sse/translator/concerns/toolCall.js';
import { translateRequest } from '../../open-sse/translator/index.js';
import { FORMATS } from '../../open-sse/translator/formats.js';

const openaiCall = (...ids) => ({
  role: 'assistant',
  content: null,
  tool_calls: ids.map((id) => ({
    id,
    type: 'function',
    function: { name: 'Bash', arguments: '{}' },
  })),
});
const openaiResult = (id, content = 'ok') => ({ role: 'tool', tool_call_id: id, content });

const run = (messages) => repairOrphanToolResults({ messages }).messages;
const textOf = (msg) =>
  typeof msg.content === 'string'
    ? msg.content
    : Array.isArray(msg.content)
      ? msg.content.map((b) => b?.text || '').join('\n')
      : '';

describe('orphan tool result repair (#2236)', () => {
  it('salvages an OpenAI tool result whose call is gone', () => {
    const out = run([
      { role: 'user', content: 'go' },
      openaiResult('ghost', 'the file said hello'),
    ]);

    expect(out.some((m) => m.role === 'tool')).toBe(false);
    expect(out.map(textOf).join('\n')).toContain('[Tool result: the file said hello]');
  });

  it('salvages a Claude tool_result block whose tool_use is gone', () => {
    const out = run([
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'ghost', content: 'salvage me' }],
      },
    ]);

    const blocks = out.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
    expect(blocks.some((b) => b?.type === 'tool_result')).toBe(false);
    expect(out.map(textOf).join('\n')).toContain('[Tool result: salvage me]');
  });

  it('keeps a result that does have its call', () => {
    const messages = [openaiCall('call_1'), openaiResult('call_1', 'kept')];
    const out = run(messages);

    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'kept' });
  });

  it('keeps only the first result for a call and salvages the duplicate', () => {
    const out = run([
      openaiCall('call_1'),
      openaiResult('call_1', 'first'),
      openaiResult('call_1', 'second'),
    ]);

    const kept = out.filter((m) => m.role === 'tool');
    expect(kept).toHaveLength(1);
    expect(kept[0].content).toBe('first');
    expect(out.map(textOf).join('\n')).toContain('[Tool result: second]');
  });

  it('drops an image-only orphan rather than inventing text for it', () => {
    const out = run([
      { role: 'user', content: 'go' },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'ghost',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'IMG' } },
            ],
          },
        ],
      },
    ]);

    expect(JSON.stringify(out)).not.toContain('IMG');
    expect(JSON.stringify(out)).not.toContain('Tool result');
  });

  it('does not leave two user turns in a row after salvage', () => {
    const out = run([
      { role: 'user', content: 'before' },
      openaiResult('ghost', 'orphan'),
      { role: 'user', content: 'after' },
    ]);

    for (let i = 1; i < out.length; i++) {
      expect(out[i].role === 'user' && out[i - 1].role === 'user').toBe(false);
    }
    const joined = out.map(textOf).join('\n');
    expect(joined).toContain('before');
    expect(joined).toContain('[Tool result: orphan]');
    expect(joined).toContain('after');
  });

  it('leaves a body with no tool results untouched', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    expect(run([...messages])).toEqual(messages);
  });

  it('leaves a Responses-shaped body (input[], no messages) alone', () => {
    const body = { input: [{ type: 'function_call_output', call_id: 'ghost', output: 'x' }] };
    expect(repairOrphanToolResults(body)).toBe(body);
  });
});

// The point of doing this once, before translation, is that every target format
// then inherits it. Before the repair, Claude received an unmatched tool_result
// (rejected outright) and Gemini received nothing at all (silently lost).
describe('orphan repair reaches every target format (#2236)', () => {
  const orphaned = () => ({
    messages: [
      { role: 'user', content: 'go' },
      { role: 'tool', tool_call_id: 'ghost', content: 'orphaned output' },
    ],
  });

  it('Claude target carries no unmatched tool_result', () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.CLAUDE,
      'claude-opus-4-6',
      orphaned(),
      true,
      { apiKey: 'sk-x' },
      'claude'
    );
    const json = JSON.stringify(out);
    expect(json).not.toContain('tool_result');
    expect(json).toContain('orphaned output');
  });

  it('Gemini target keeps the content instead of dropping it', () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.GEMINI,
      'gemini-3-pro',
      orphaned(),
      true,
      { apiKey: 'k' },
      'gemini'
    );
    expect(JSON.stringify(out)).toContain('orphaned output');
  });

  it('Responses target builds no unmatched function_call_output', () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      'gpt-5',
      orphaned(),
      true,
      { apiKey: 'k' },
      'openai'
    );
    expect(JSON.stringify(out)).not.toContain('function_call_output');
    expect(JSON.stringify(out)).toContain('orphaned output');
  });
});
