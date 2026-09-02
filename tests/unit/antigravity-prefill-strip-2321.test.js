import { describe, expect, it } from 'vitest';
import '../translator/registerAll.js';
import { openaiToClaudeRequestForAntigravity } from '../../open-sse/translator/request/openai-to-claude.js';
import { translateRequest } from '../../open-sse/translator/index.js';
import { FORMATS } from '../../open-sse/translator/formats.js';
import { ROLE, GEMINI_ROLE, CLAUDE_BLOCK } from '../../open-sse/translator/schema/index.js';

// An OpenAI client may end a conversation with an assistant message as a
// prefill hint. Vertex AI's Claude endpoint has no prefill and answers 400
// "This model does not support assistant message prefill". The Antigravity
// route targets FORMATS.ANTIGRAVITY, so prepareClaudeRequest — and with it the
// assistant-prefill policy every other Claude target gets — never runs (#2321).
const convert = (messages) =>
  openaiToClaudeRequestForAntigravity(
    'claude-opus-4-6',
    { model: 'claude-opus-4-6', messages, max_tokens: 64 },
    false
  );

describe('Antigravity Claude never receives a trailing assistant turn (#2321)', () => {
  it('resolves a trailing assistant text prefill to a user turn', () => {
    const out = convert([
      { role: 'user', content: 'Write a haiku.' },
      { role: 'assistant', content: 'Here it is:' },
    ]);

    expect(out.messages.at(-1).role).toBe(ROLE.USER);
  });

  it('closes a trailing assistant tool_use with a user tool_result', () => {
    const out = convert([
      { role: 'user', content: 'Look it up.' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_a', type: 'function', function: { name: 'search', arguments: '{}' } },
        ],
      },
    ]);

    const last = out.messages.at(-1);
    expect(last.role).toBe(ROLE.USER);
    expect(last.content).toContainEqual(
      expect.objectContaining({ type: CLAUDE_BLOCK.TOOL_RESULT, tool_use_id: 'call_a' })
    );
  });

  it('leaves a conversation already ending with a user turn alone', () => {
    const messages = [
      { role: 'user', content: 'One' },
      { role: 'assistant', content: 'Two' },
      { role: 'user', content: 'Three' },
    ];
    const out = convert(messages);

    expect(out.messages).toHaveLength(3);
    expect(out.messages.at(-1).role).toBe(ROLE.USER);
    // A non-trailing assistant turn is history, not a prefill.
    expect(out.messages[1].role).toBe(ROLE.ASSISTANT);
  });

  it('handles an empty conversation without throwing', () => {
    expect(() => convert([])).not.toThrow();
  });

  it('reaches the Antigravity envelope with a user turn last', () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.ANTIGRAVITY,
      'claude-opus-4-6',
      {
        model: 'claude-opus-4-6',
        messages: [
          { role: 'user', content: 'Write a haiku.' },
          { role: 'assistant', content: 'Here it is:' },
        ],
        max_tokens: 64,
      },
      false,
      null,
      'antigravity'
    );

    expect(out.request.contents.at(-1).role).toBe(GEMINI_ROLE.USER);
  });
});
