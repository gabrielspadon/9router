import { describe, expect, it } from 'vitest';

import REGISTRY from '../../open-sse/providers/registry/index.js';
import { PROVIDERS } from '../../open-sse/providers/index.js';
import { resolveProviderAlias } from '../../open-sse/services/model.js';
import { getExecutor, hasSpecializedExecutor } from '../../open-sse/executors/index.js';

describe('zenmux-free provider', () => {
  const zmf = REGISTRY.find((e) => e.id === 'zenmux-free');

  it('is registered as a cookie-auth free provider', () => {
    expect(zmf).toBeDefined();
    expect(zmf.category).toBe('free');
    expect(zmf.authType).toBe('cookie');
    expect(zmf.transport.baseUrl).toBe('https://zenmux.ai/api/anthropic/v1/messages');
  });

  // Dispatch is by provider id, not by a transport field: getExecutor() looks the
  // id up in the executors registry, so a `transport.executor` string would be
  // read by nothing.
  it('dispatches to its own executor by provider id', () => {
    expect(hasSpecializedExecutor('zenmux-free')).toBe(true);
    expect(getExecutor('zenmux-free').constructor.name).toBe('ZenmuxFreeExecutor');
  });

  it('builds into the runtime PROVIDERS map', () => {
    expect(PROVIDERS['zenmux-free']).toBeDefined();
    expect(PROVIDERS['zenmux-free'].format).toBe('openai');
  });

  it('resolves its aliases through the model service, including uiAlias', () => {
    expect(resolveProviderAlias('zenmux-free')).toBe('zenmux-free');
    expect(resolveProviderAlias('zmf')).toBe('zenmux-free');
    expect(resolveProviderAlias('zenmux')).toBe('zenmux-free');
    expect(resolveProviderAlias('zm')).toBe('zenmux-free');
    expect(resolveProviderAlias('ZF')).toBe('zenmux-free');
  });

  it('keeps every registry id unique after adding zenmux-free', () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
