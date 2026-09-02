import { describe, it, expect } from 'vitest';

import { reorderByContextFit, handleComboChat } from '../../open-sse/services/combo.js';

// #1089: combo/fallback rotation ignored each model's declared context window,
// so a request that only fits a large-context model still tried an undersized
// one first and burned a round-trip on a guaranteed context_length_exceeded
// rejection before reaching a model that could actually serve it.

describe('reorderByContextFit (#1089)', () => {
  it('floats a large-context model ahead of an undersized one for a big request', () => {
    // gpt-3.5-turbo: 16385 contextWindow (PATTERN_CAPABILITIES). claude-opus-5: 1,000,000.
    const models = ['openai/gpt-3.5-turbo', 'anthropic/claude-opus-5'];
    const out = reorderByContextFit(models, 50000);
    expect(out[0]).toBe('anthropic/claude-opus-5');
    expect(out).toContain('openai/gpt-3.5-turbo'); // never dropped
    expect(out).toHaveLength(2);
  });

  it('never drops a model even when NONE fit — the combo must still get a candidate to try', () => {
    const models = ['openai/gpt-3.5-turbo', 'openai/gpt-3.5-turbo-16k'];
    const out = reorderByContextFit(models, 5_000_000);
    expect(out).toHaveLength(2);
    expect(new Set(out)).toEqual(new Set(models));
  });

  it('leaves order unchanged when nothing is required (0 / falsy)', () => {
    const models = ['a/x', 'b/y'];
    expect(reorderByContextFit(models, 0)).toBe(models);
    expect(reorderByContextFit(models, null)).toBe(models);
  });

  it('single model -> unchanged', () => {
    const models = ['a/x'];
    expect(reorderByContextFit(models, 1)).toBe(models);
  });
});

describe('handleComboChat prioritizes the context-fitting model first (#1089)', () => {
  it('tries the large-context model before the undersized one for a big prompt', async () => {
    const bigText = 'word '.repeat(20000); // pushes the rough estimate well past 16385 tokens
    const body = { messages: [{ role: 'user', content: bigText }] };

    const attempts = [];
    const handleSingleModel = async (b, modelStr) => {
      attempts.push(modelStr);
      return new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    };

    await handleComboChat({
      body,
      models: ['openai/gpt-3.5-turbo', 'anthropic/claude-opus-5'],
      handleSingleModel,
      log: { info: () => {}, warn: () => {}, debug: () => {} },
      comboName: 'ctx-test-1089',
      comboStrategy: 'fallback',
    });

    expect(attempts[0]).toBe('anthropic/claude-opus-5');
  });
});
