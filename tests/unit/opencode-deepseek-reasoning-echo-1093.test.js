import { describe, it, expect } from 'vitest';
import { injectReasoningContent } from '../../open-sse/utils/reasoningContentInjector.js';
import { FORMATS } from '../../open-sse/translator/formats.js';

// #1093 — Claude Code against oc/deepseek-v4-flash-free came back
//   400 "The `reasoning_content` in the thinking mode must be passed back to the API."
// on v0.4.45. The contract DeepSeek states is that every assistant turn replayed
// to a thinking model carries a non-empty reasoning_content. This pins that the
// echo is in place on the exact provider/model pair the report names, in the
// exact claude -> openai direction its log shows, so a later edit to the rule
// table cannot quietly drop the model back into the 400.
const assistantWithToolCall = () => ({
  role: 'assistant',
  content: '',
  // claude-to-openai emits "" here for a tool-call turn with no thinking, which
  // is the shape that has to be topped up rather than left alone.
  reasoning_content: '',
  tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'Read', arguments: '{}' } }],
});

const body = () => ({
  messages: [
    { role: 'user', content: 'read the file' },
    assistantWithToolCall(),
    { role: 'tool', tool_call_id: 'call_1', content: 'ok' },
    { role: 'assistant', content: 'done' },
    { role: 'user', content: 'and now?' },
  ],
});

const assistantsOf = (b) => b.messages.filter((m) => m.role === 'assistant');

describe('deepseek thinking models get reasoning_content echoed back (#1093)', () => {
  it.each(['opencode', 'opencode-zen', 'opencode-go'])(
    '%s/deepseek-v4-flash-free carries it on every assistant turn',
    (provider) => {
      const out = injectReasoningContent({
        provider,
        model: 'deepseek-v4-flash-free',
        body: body(),
        targetFormat: FORMATS.OPENAI,
      });
      expect(assistantsOf(out)).toHaveLength(2);
      for (const m of assistantsOf(out)) {
        expect(typeof m.reasoning_content).toBe('string');
        expect(m.reasoning_content.length).toBeGreaterThan(0);
      }
    }
  );

  it('does not overwrite reasoning the client already sent back', () => {
    const input = body();
    input.messages[3].reasoning_content = "the model's actual thinking";
    const out = injectReasoningContent({
      provider: 'opencode',
      model: 'deepseek-v4-flash-free',
      body: input,
      targetFormat: FORMATS.OPENAI,
    });
    expect(out.messages[3].reasoning_content).toBe("the model's actual thinking");
  });

  it('leaves user and tool turns untouched', () => {
    const out = injectReasoningContent({
      provider: 'opencode',
      model: 'deepseek-v4-flash-free',
      body: body(),
      targetFormat: FORMATS.OPENAI,
    });
    for (const m of out.messages.filter((x) => x.role !== 'assistant')) {
      expect(m.reasoning_content).toBeUndefined();
    }
  });

  it('does not fire for a model with no such contract', () => {
    const out = injectReasoningContent({
      provider: 'opencode',
      model: 'claude-sonnet-5',
      body: body(),
      targetFormat: FORMATS.OPENAI,
    });
    expect(out.messages[3].reasoning_content).toBeUndefined();
  });
});
