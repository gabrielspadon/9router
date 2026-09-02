// #3045 — DeepSeek's own platform runs web search server-side for the V4 family
// (api-docs.deepseek.com/guides/responses_api lists web_search /
// web_search_2025_08_26 as Supported for deepseek-v4-flash / deepseek-v4-pro).
//
// The provider-scoped entry is the whole point: PROVIDER_CAPABILITIES REPLACES
// the pattern caps instead of merging over them, so this file also pins every
// capability "*deepseek-v4*" used to supply. Dropping one there is silent.
import { describe, expect, it } from 'vitest';
import { getCapabilitiesForModel } from 'open-sse/providers/capabilities.js';

const DEEPSEEK_SEARCH_MODELS = [
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'deepseek-v4-pro-max',
  'deepseek-v4-pro-none',
];

describe('DeepSeek V4 search capability (#3045)', () => {
  it.each(DEEPSEEK_SEARCH_MODELS)(
    'marks %s as search-capable on the deepseek provider',
    (model) => {
      expect(getCapabilitiesForModel('deepseek', model).search).toBe(true);
    }
  );

  it.each(DEEPSEEK_SEARCH_MODELS)(
    'reaches the same result through the ui alias for %s',
    (model) => {
      expect(getCapabilitiesForModel('ds', model).search).toBe(true);
    }
  );

  it.each(DEEPSEEK_SEARCH_MODELS)('keeps every pattern-supplied capability for %s', (model) => {
    // Exactly what PATTERN "*deepseek-v4*" resolved to before the provider
    // entry existed. A provider entry that forgets one of these reverts it to
    // the DEFAULT_CAPABILITIES floor with no other signal.
    expect(getCapabilitiesForModel('deepseek', model)).toMatchObject({
      reasoning: true,
      thinkingFormat: 'deepseek',
      contextWindow: 1000000,
      maxOutput: 384000,
      tools: true,
      vision: false,
    });
  });

  it('leaves third-party hosts of the same weights at search:false', () => {
    // These serve the model without DeepSeek's hosted search tool, so the
    // generic pattern must not be widened.
    expect(
      getCapabilitiesForModel('fireworks', 'accounts/fireworks/models/deepseek-v4-flash').search
    ).toBe(false);
    expect(getCapabilitiesForModel('volcengine-ark', 'DeepSeek-V4-Flash').search).toBe(false);
    expect(getCapabilitiesForModel('nvidia', 'deepseek-ai/deepseek-v4-flash-0731').search).toBe(
      false
    );
    expect(getCapabilitiesForModel('codebuddy-cn', 'deepseek-v4-flash').search).toBe(false);
  });

  it("leaves DeepSeek's non-V4 models at search:false", () => {
    // The Responses API model row names only the V4 family.
    expect(getCapabilitiesForModel('deepseek', 'deepseek-chat').search).toBe(false);
    expect(getCapabilitiesForModel('deepseek', 'deepseek-reasoner').search).toBe(false);
  });
});
