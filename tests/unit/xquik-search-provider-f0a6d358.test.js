// Upstream f0a6d3581 — Xquik as an X search provider.
//
// Two separable concerns land together:
//   1. the provider itself (GET + x-api-key builder, tweets normalizer, and the
//      credits / pagination fields the search index never carried), and
//   2. an independent fix — probeWebProvider validated a key against the
//      provider's PLAIN baseUrl, so testing a key ran a real, charged search.
//      A provider that declares a no-charge validateUrl must be probed there.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildSearchRequest } from 'open-sse/handlers/search/callers.js';
import { normalizeSearchResponse } from 'open-sse/handlers/search/normalizers.js';
import { handleSearchCore } from 'open-sse/handlers/search/index.js';
import xquik from 'open-sse/providers/registry/xquik.js';
import ollamaSearch from 'open-sse/providers/registry/ollama-search.js';
import REGISTRY from 'open-sse/providers/registry/index.js';
import { AI_PROVIDERS } from '@/shared/constants/providers.js';

const TWEETS = {
  tweets: [
    {
      id: '1',
      text: 'release cut',
      createdAt: '2026-08-01T00:00:00Z',
      author: { username: 'github', name: 'GitHub' },
      media: [{ mediaUrl: 'https://pbs.example/img.jpg' }],
    },
    { id: '2', text: 'second', author: { username: 'nine' } },
  ],
  has_next_page: true,
  next_cursor: 'cursor-2',
};

// ── 1. the provider ───────────────────────────────────────────────────────

describe('xquik registry entry', () => {
  it('is an apikey webSearch provider searching X', () => {
    expect(xquik.id).toBe('xquik');
    expect(xquik.serviceKinds).toEqual(['webSearch']);
    expect(xquik.authType).toBe('apikey');
    expect(xquik.searchConfig.searchTypes).toEqual(['x']);
    expect(xquik.searchConfig.authHeader).toBe('x-api-key');
    expect(xquik.searchConfig.method).toBe('GET');
  });

  it('declares a no-charge validateUrl distinct from the charged search URL', () => {
    expect(xquik.searchConfig.baseUrl).toBe('https://xquik.com/api/v1/x/tweets/search');
    expect(xquik.searchConfig.validateUrl).toBe('https://xquik.com/api/v1/credits');
  });

  it('bills per returned post rather than per query', () => {
    expect(xquik.searchConfig.creditsPerResult).toBe(1);
    expect(xquik.searchConfig.costPerQuery).toBeUndefined();
  });

  it('is exported from the generated registry index and reaches AI_PROVIDERS', () => {
    expect(REGISTRY.filter((p) => p.id === 'xquik')).toHaveLength(1);
    expect(AI_PROVIDERS.xquik?.searchConfig?.creditsPerResult).toBe(1);
  });
});

describe('xquik request builder', () => {
  const cfg = { id: 'xquik', ...xquik.searchConfig };

  it('sends a GET with the key in x-api-key', () => {
    const { url, init } = buildSearchRequest(cfg, {
      query: 'from:github',
      maxResults: 10,
      token: 'k1',
    });
    expect(init.method).toBe('GET');
    expect(init.headers['x-api-key']).toBe('k1');
    expect(init.headers.Authorization).toBeUndefined();
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(xquik.searchConfig.baseUrl);
    expect(u.searchParams.get('q')).toBe('from:github');
    expect(u.searchParams.get('limit')).toBe('10');
  });

  it('passes the cursor and queryType through provider_options', () => {
    const { url } = buildSearchRequest(cfg, {
      query: 'q',
      maxResults: 5,
      token: 'k1',
      language: 'en',
      providerOptions: { cursor: 'cursor-2', queryType: 'Latest' },
    });
    const u = new URL(url);
    expect(u.searchParams.get('cursor')).toBe('cursor-2');
    expect(u.searchParams.get('queryType')).toBe('Latest');
    expect(u.searchParams.get('language')).toBe('en');
  });

  it('rejects a queryType Xquik does not accept, and a missing key', () => {
    expect(() =>
      buildSearchRequest(cfg, {
        query: 'q',
        maxResults: 5,
        token: 'k1',
        providerOptions: { queryType: 'Wrong' },
      })
    ).toThrow(/Latest or Top/);
    expect(() => buildSearchRequest(cfg, { query: 'q', maxResults: 5 })).toThrow(/API key/);
  });
});

describe('xquik normalizer', () => {
  it('turns the tweets envelope into results with a permalink and author', () => {
    const out = normalizeSearchResponse('xquik', TWEETS, 'q', 'x');
    expect(out.results).toHaveLength(2);
    expect(out.results[0].url).toBe('https://x.com/github/status/1');
    expect(out.results[0].snippet).toBe('release cut');
    expect(out.results[0].metadata.author).toBe('@github');
    expect(out.results[0].metadata.source_type).toBe('x_post');
    expect(out.results[0].metadata.image_url).toBe('https://pbs.example/img.jpg');
  });

  it('reports cursor pagination', () => {
    const out = normalizeSearchResponse('xquik', TWEETS, 'q', 'x');
    expect(out.pagination).toEqual({ has_more: true, next_cursor: 'cursor-2' });
    expect(normalizeSearchResponse('xquik', { tweets: [] }, 'q', 'x').pagination).toEqual({
      has_more: false,
      next_cursor: null,
    });
  });
});

describe('the search result carries credits and pagination', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports provider_credits_used per result and forwards pagination', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(TWEETS), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );

    const result = await handleSearchCore({
      body: { query: 'from:github', max_results: 10 },
      provider: AI_PROVIDERS.xquik,
      providerConfig: xquik.searchConfig,
      credentials: { apiKey: 'k1' },
    });

    expect(result.success).toBe(true);
    expect(result.data.usage.provider_credits_used).toBe(2);
    // Xquik bills credits, not dollars — reporting $0 would be a lie, not a default.
    expect(result.data.usage.search_cost_usd).toBeNull();
    expect(result.data.pagination).toEqual({ has_more: true, next_cursor: 'cursor-2' });
  });

  it('omits the credits field for a provider that does not bill per result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ results: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );

    const result = await handleSearchCore({
      body: { query: 'q' },
      provider: AI_PROVIDERS['ollama-search'],
      providerConfig: ollamaSearch.searchConfig,
      credentials: { apiKey: 'k1' },
    });

    expect(result.success).toBe(true);
    expect(result.data.usage.provider_credits_used).toBeUndefined();
    expect(result.data.usage.search_cost_usd).toBe(0);
    expect(result.data.pagination).toBeUndefined();
  });
});

// ── 2. the independent fix: validating a key must not spend the user's credit ──

const originalDataDir = process.env.DATA_DIR;
const originalFetch = global.fetch;
let dataDir;
let POST;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'tokenproxy-xquik-validate-'));
  process.env.DATA_DIR = dataDir;
  ({ POST } = await import('../../src/app/api/providers/validate/route.js'));
});

afterAll(() => {
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe('POST /api/providers/validate probes the no-charge endpoint', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function okFetch() {
    const mock = vi.fn(
      async () =>
        new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    global.fetch = mock;
    return mock;
  }

  it('prefers validateUrl over the charged search endpoint', async () => {
    const fetchMock = okFetch();
    const res = await POST(
      new Request('http://localhost/api/providers/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'xquik', apiKey: 'k1' }),
      })
    );

    expect((await res.json()).valid).toBe(true);
    const hit = String(fetchMock.mock.calls[0][0]);
    expect(hit).toBe(xquik.searchConfig.validateUrl);
    expect(hit).not.toContain('/tweets/search');
  });

  it('still falls back to baseUrl for a provider that declares no validateUrl', async () => {
    const fetchMock = okFetch();
    const res = await POST(
      new Request('http://localhost/api/providers/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'ollama-search', apiKey: 'k1' }),
      })
    );

    expect((await res.json()).valid).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toBe(ollamaSearch.searchConfig.baseUrl);
  });
});
