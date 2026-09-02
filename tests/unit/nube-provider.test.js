import { describe, expect, it } from 'vitest';

import REGISTRY from '../../open-sse/providers/registry/index.js';
import { PROVIDERS, PROVIDER_MODELS } from '../../open-sse/providers/index.js';

describe('Nube.sh provider', () => {
  const nube = REGISTRY.find((e) => e.id === 'nube');

  it('is registered as an OpenAI-compatible apikey provider', () => {
    expect(nube).toBeDefined();
    expect(nube.category).toBe('apikey');
    expect(nube.transport.baseUrl).toBe('https://ai.nube.sh/api/v1/chat/completions');
    expect(nube.transport.validateUrl).toBe('https://ai.nube.sh/api/v1/models');
    expect(nube.alias).toBe('nube');
  });

  it('builds into the runtime PROVIDERS map with the openai format default', () => {
    expect(PROVIDERS.nube).toBeDefined();
    expect(PROVIDERS.nube.format).toBe('openai');
    expect(PROVIDERS.nube.baseUrl).toBe('https://ai.nube.sh/api/v1/chat/completions');
  });

  it('exposes its seed models', () => {
    const ids = (PROVIDER_MODELS.nube || []).map((m) => m.id);
    expect(ids).toContain('zai-org/GLM-5.2');
    expect(ids).toContain('moonshotai/Kimi-K2.6');
    expect(ids).toContain('nube/Nube-Choice');
  });

  it('keeps every registry id unique after adding nube', () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
