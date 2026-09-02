import { describe, expect, it } from 'vitest';
import '../translator/registerAll.js';
import { getCapabilitiesForModel } from '../../open-sse/providers/capabilities.js';
import { applyThinking } from '../../open-sse/translator/concerns/thinkingUnified.js';
import { translateRequest } from '../../open-sse/translator/index.js';
import { FORMATS } from '../../open-sse/translator/formats.js';

// Gemma 4 on the Gemini API rejects two shapes every other Gemini route
// accepts, both with a bare 400 INVALID_ARGUMENT: a budget-based
// thinkingConfig, and replayed synthetic thought parts / thoughtSignature on
// functionCall history (#2480).
const toolHistory = () => ({
  messages: [
    { role: 'user', content: 'Look something up.' },
    {
      role: 'assistant',
      content: 'I will check.',
      reasoning_content: 'internal reasoning should not be replayed',
      tool_calls: [
        {
          id: 'call_search',
          type: 'function',
          function: { name: 'search_files', arguments: '{"pattern":"x"}' },
        },
      ],
    },
    { role: 'tool', tool_call_id: 'call_search', content: '{"result":"ok"}' },
    { role: 'user', content: 'Summarize briefly.' },
  ],
  reasoning_effort: 'high',
  max_tokens: 128,
});

const toGemini = (model) =>
  translateRequest(
    FORMATS.OPENAI,
    FORMATS.GEMINI,
    model,
    toolHistory(),
    false,
    { apiKey: 'test' },
    'gemini'
  );

describe('Gemma 4 on the Gemini API (#2480)', () => {
  it('asks for level-based thinking, not a budget', () => {
    expect(getCapabilitiesForModel('gemini', 'gemma-4-31b-it')).toMatchObject({
      reasoning: true,
      thinkingFormat: 'gemini-level',
    });

    const body = { reasoning_effort: 'high' };
    applyThinking(FORMATS.GEMINI, 'gemma-4-31b-it', body, 'gemini');

    expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe('high');
    expect(body.generationConfig.thinkingConfig.thinkingBudget).toBeUndefined();
  });

  it('leaves the older Gemma line on its budget-free defaults', () => {
    expect(getCapabilitiesForModel('gemini', 'gemma-3-27b-it').thinkingFormat).toBeNull();
  });

  it('replays tool history without synthetic thoughts or signatures', () => {
    const out = toGemini('gemma-4-31b-it');
    const serialized = JSON.stringify(out);

    expect(serialized).not.toContain('thoughtSignature');
    expect(serialized).not.toContain('internal reasoning should not be replayed');

    // The turn itself must survive the strip.
    const modelTurn = out.contents.find((turn) => turn.role === 'model');
    expect(modelTurn.parts).toContainEqual({ text: 'I will check.' });
    expect(modelTurn.parts).toContainEqual({
      functionCall: { id: 'call_search', name: 'search_files', args: { pattern: 'x' } },
    });
  });

  it('keeps both for a regular Gemini route', () => {
    const serialized = JSON.stringify(toGemini('gemini-2.5-flash'));

    expect(serialized).toContain('thoughtSignature');
    expect(serialized).toContain('internal reasoning should not be replayed');
  });
});
