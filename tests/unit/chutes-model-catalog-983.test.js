import { describe, expect, it } from 'vitest';
import REGISTRY from '../../open-sse/providers/registry/index.js';
import { FILTERS } from '../../src/app/api/providers/suggested-models/filters.js';

// #983 "Auto-load Chutes model catalog": Chutes previously had no static
// models[] and no modelsFetcher, so every model had to be entered by hand.
// This lane's fix is the registry entry that other consumers (suggested-models
// proxy, provider detail page, /v1/models dynamic listing) build on. Those
// consumers live outside open-sse/providers/** and open-sse/config/**, so they
// are not exercised here; this file pins the registry prerequisite only.

const chutes = () => REGISTRY.find((r) => r.id === 'chutes');

describe('#983 chutes registry auto-load prerequisite', () => {
  it('declares a modelsFetcher pointing at the public catalog', () => {
    expect(chutes().modelsFetcher).toEqual({
      url: 'https://llm.chutes.ai/v1/models',
      type: 'openai-list',
    });
  });

  it('opts into passthroughModels so any fetched id can be selected', () => {
    expect(chutes().passthroughModels).toBe(true);
  });

  it('uses a filter type that suggested-models/filters.js actually implements', () => {
    // Regression guard: several other registry entries (groq, meta,
    // vercel-ai-gateway, perplexity-agent) declare type "openai", which has no
    // matching FILTERS key and 400s at src/app/api/providers/suggested-models
    // /route.js. That is pre-existing debt in those files, out of scope for
    // #983, but Chutes must not repeat it.
    expect(typeof FILTERS[chutes().modelsFetcher.type]).toBe('function');
  });

  it('leaves the pinned transport (baseUrl/validateUrl/category) unchanged', () => {
    const c = chutes();
    expect(c.category).toBe('apikey');
    expect(c.transport.baseUrl).toBe('https://llm.chutes.ai/v1/chat/completions');
    expect(c.transport.validateUrl).toBe('https://llm.chutes.ai/v1/models');
  });
});
