import { describe, it, expect } from 'vitest';
import { getEmbeddingAdapter } from '../../open-sse/handlers/embeddingProviders/index.js';
import { PROVIDER_MEDIA } from '../../open-sse/providers/index.js';

describe('cloudflare-ai embeddings support', () => {
  it('exposes an embedding adapter with the account-scoped URL', () => {
    const adapter = getEmbeddingAdapter('cloudflare-ai');
    expect(adapter).toBeTruthy();
    const url = adapter.buildUrl('@cf/baai/bge-m3', {
      providerSpecificData: { accountId: 'acc123' },
    });
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acc123/ai/v1/embeddings');
  });

  it('refuses to build a URL without accountId (no silent fallback)', () => {
    const adapter = getEmbeddingAdapter('cloudflare-ai');
    expect(() => adapter.buildUrl('@cf/baai/bge-m3', {})).toThrow(/accountId/);
  });

  it('sends the OpenAI-shaped body with bearer auth', () => {
    const adapter = getEmbeddingAdapter('cloudflare-ai');
    const body = adapter.buildBody('@cf/baai/bge-base-en-v1.5', { input: ['hello'] });
    expect(body).toEqual({ model: '@cf/baai/bge-base-en-v1.5', input: ['hello'] });
    const headers = adapter.buildHeaders({ apiKey: 'tok' });
    expect(headers.Authorization).toBe('Bearer tok');
  });

  it('registry lists the three BGE models under embedding service kind', () => {
    const media = PROVIDER_MEDIA['cloudflare-ai'];
    expect(media.serviceKinds).toContain('embedding');
    const ids = media.embeddingConfig.models.map((m) => m.id);
    expect(ids).toEqual([
      '@cf/baai/bge-base-en-v1.5',
      '@cf/baai/bge-large-en-v1.5',
      '@cf/baai/bge-m3',
    ]);
  });
});
