import { describe, expect, it } from 'vitest';

import REGISTRY from '../../open-sse/providers/registry/index.js';
import { PROVIDERS, PROVIDER_MODELS } from '../../open-sse/providers/index.js';

describe('Chenzk API provider', () => {
  const chenzk = REGISTRY.find((e) => e.id === 'chenzk');

  it('is registered as an OpenAI-compatible apikey provider', () => {
    expect(chenzk).toBeDefined();
    expect(chenzk.category).toBe('apikey');
    expect(chenzk.transport.baseUrl).toBe('https://chenzk.top/v1/chat/completions');
    expect(chenzk.transport.validateUrl).toBe('https://chenzk.top/v1/models');
    expect(chenzk.alias).toBe('chenzk');
    expect(chenzk.aliases).toContain('ezkielyna');
  });

  it('builds into the runtime PROVIDERS map with the openai format default', () => {
    expect(PROVIDERS.chenzk).toBeDefined();
    expect(PROVIDERS.chenzk.format).toBe('openai');
    expect(PROVIDERS.chenzk.baseUrl).toBe('https://chenzk.top/v1/chat/completions');
  });

  it('exposes its seed models', () => {
    const ids = (PROVIDER_MODELS.chenzk || []).map((m) => m.id);
    expect(ids).toContain('gpt-5.4');
    expect(ids).toContain('claude-sonnet-4-6');
    expect(ids).toContain('gpt-image-1');
  });

  it('keeps every registry id unique after adding chenzk', () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
