// z.ai / GLM thinking: the zai wire format needs a top-level reasoning_effort
// (low|high|max) beside thinking:{type:"enabled"} to control reasoning depth.
// Only GLM-5.2+ reads it (capabilities.thinkingEffortSupported); older GLM
// ignores the field, so it must not be sent there. extractThinking must also
// read a client-supplied effort BEFORE the thinking object, otherwise
// thinking:{type:"enabled"} collapses the request to mode:auto and the level
// the client asked for is lost. Upstream 56a40765e.
import { describe, it, expect } from 'vitest';
import {
  extractThinking,
  applyThinking,
} from '../../open-sse/translator/concerns/thinkingUnified.js';
import { getCapabilitiesForModel } from '../../open-sse/providers/capabilities.js';

const apply = (targetFormat, model, body, provider) => {
  const b = JSON.parse(JSON.stringify(body));
  applyThinking(targetFormat, model, b, provider);
  return b;
};

describe('extractThinking effort precedence', () => {
  it('reasoning_effort wins over thinking:{type:enabled}', () => {
    expect(
      extractThinking({
        thinking: { type: 'enabled' },
        reasoning_effort: 'high',
      })
    ).toEqual({ mode: 'level', level: 'high' });
  });

  it('reasoning.effort wins over thinking:{type:enabled}', () => {
    expect(
      extractThinking({
        thinking: { type: 'enabled' },
        reasoning: { effort: 'medium' },
      })
    ).toEqual({ mode: 'level', level: 'medium' });
  });

  // The effort only pre-empts an UNLEVELLED marker. A budget or a disabled
  // marker is more specific and still wins, which is what stops a provider-level
  // default (injected as reasoning_effort in chatCore) from overriding an
  // explicit client intent (#2927).
  it('an explicit Claude budget still wins over reasoning_effort', () => {
    expect(
      extractThinking({
        thinking: { type: 'enabled', budget_tokens: 4096 },
        reasoning_effort: 'high',
      })
    ).toEqual({ mode: 'budget', budget: 4096 });
  });

  it('thinking:{type:disabled} still wins over reasoning_effort', () => {
    expect(
      extractThinking({
        thinking: { type: 'disabled' },
        reasoning_effort: 'high',
      })
    ).toEqual({ mode: 'none' });
  });

  it('thinking:{type:disabled} with no effort still means none', () => {
    expect(extractThinking({ thinking: { type: 'disabled' } })).toEqual({
      mode: 'none',
    });
  });
});

describe('zai reasoning_effort is gated on thinkingEffortSupported', () => {
  it.each([
    ['low', 'low'],
    ['minimal', 'low'],
    ['medium', 'high'],
    ['high', 'high'],
    ['max', 'max'],
    ['xhigh', 'max'],
  ])('GLM-5.3 %s → reasoning_effort=%s', (input, expected) => {
    const out = apply('openai', 'glm-5.3', { reasoning_effort: input }, 'glm-cn');
    expect(out.thinking).toEqual({ type: 'enabled' });
    expect(out.reasoning_effort).toBe(expected);
  });

  it('GLM-5.2 declares the flag and emits the effort', () => {
    expect(getCapabilitiesForModel('glm-cn', 'glm-5.2').thinkingEffortSupported).toBe(true);
    const out = apply('openai', 'glm-5.2', { reasoning_effort: 'low' }, 'glm-cn');
    expect(out.thinking).toEqual({ type: 'enabled' });
    expect(out.reasoning_effort).toBe('low');
  });

  it('GLM-4.7 does not declare the flag and is unchanged — z.ai ignores the field', () => {
    expect(getCapabilitiesForModel('glm-cn', 'glm-4.7').thinkingEffortSupported).toBeFalsy();
    const out = apply('openai', 'glm-4.7', { reasoning_effort: 'low' }, 'glm-cn');
    expect(out.thinking).toEqual({ type: 'enabled' });
    expect(out.reasoning_effort).toBeUndefined();
  });

  it('disabling thinking still wins over the effort field', () => {
    const out = apply('openai', 'glm-5.3', { reasoning_effort: 'none' }, 'glm-cn');
    expect(out.enable_thinking).toBe(false);
    expect(out.thinking).toBeUndefined();
    expect(out.reasoning_effort).toBeUndefined();
  });
});
