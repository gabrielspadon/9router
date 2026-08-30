import { describe, expect, it } from 'vitest';

import REGISTRY from '../../open-sse/providers/registry/index.js';
import { PROVIDERS, PROVIDER_MODELS } from '../../open-sse/providers/index.js';

describe('Xunfei Spark provider', () => {
  const xunfei = REGISTRY.find((e) => e.id === 'xunfei');

  it('is registered as an OpenAI-compatible apikey provider', () => {
    expect(xunfei).toBeDefined();
    expect(xunfei.category).toBe('apikey');
    expect(xunfei.transport.baseUrl).toBe(
      'https://maas-coding-api.cn-huabei-1.xf-yun.com/v2/chat/completions'
    );
    expect(xunfei.alias).toBe('xunfei');
    expect(xunfei.aliases).toContain('spark');
  });

  it('builds into the runtime PROVIDERS map with the openai format default', () => {
    expect(PROVIDERS.xunfei).toBeDefined();
    expect(PROVIDERS.xunfei.format).toBe('openai');
    expect(PROVIDERS.xunfei.baseUrl).toBe(
      'https://maas-coding-api.cn-huabei-1.xf-yun.com/v2/chat/completions'
    );
  });

  it('exposes its seed models', () => {
    const ids = (PROVIDER_MODELS.xunfei || []).map((m) => m.id);
    expect(ids).toContain('xsparkx2flash');
    expect(ids).toContain('xop3qwencodernext');
  });

  it('keeps every registry id unique after adding xunfei', () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
