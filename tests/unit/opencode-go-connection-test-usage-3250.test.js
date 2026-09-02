import { describe, it, expect, vi, beforeEach } from 'vitest';

// PR #3250. The OpenCode Go connection test probed the key by POSTing a real chat
// completion, so every click on "test connection" was a billed request. The provider
// already serves a free usage endpoint (open-sse/services/usage/misc.js,
// getOpencodeGoUsage → GET /zen/go/v1/usage) which proves the credential just as
// well. A 200 there reporting zero remaining quota is a VALID key with no quota
// left, not an invalid key, so only 401/403/404 may condemn it.

function opencodeGoConnection() {
  return {
    id: 'conn_zen',
    provider: 'opencode-go',
    authType: 'apikey',
    apiKey: 'sk-zen-key',
    providerSpecificData: {},
  };
}

async function runConnectionTest(response) {
  const fetched = [];
  vi.doMock('@/lib/localDb', () => ({
    getProviderConnectionById: vi.fn(async () => opencodeGoConnection()),
    updateProviderConnection: vi.fn(async () => ({})),
  }));
  vi.doMock('@/lib/network/connectionProxy', () => ({
    resolveConnectionProxyConfig: vi.fn(async () => ({ kind: 'none' })),
    toConnectionProxyOptions: vi.fn(() => ({})),
  }));
  vi.doMock('open-sse/utils/proxyFetch.js', () => ({
    proxyAwareFetch: vi.fn(async (url, options) => {
      fetched.push({ url: String(url), method: options?.method || 'GET' });
      return response;
    }),
  }));

  const { testSingleConnection } =
    await import('../../src/app/api/providers/[id]/test/testUtils.js');
  const result = await testSingleConnection('conn_zen');
  return { result, fetched };
}

// A real 200 from the usage endpoint for an exhausted key: every window at 100%.
const ZERO_REMAINING = {
  ok: true,
  status: 200,
  json: async () => ({
    usage: {
      rolling: { percent: 100, resetsAt: null },
      weekly: { percent: 100, resetsAt: null },
      monthly: { percent: 100, resetsAt: null },
    },
  }),
  text: async () => '{}',
};

describe('the OpenCode Go connection test does not bill the user (#3250)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('never touches a chat-completions path', async () => {
    const { fetched } = await runConnectionTest(ZERO_REMAINING);
    expect(fetched.length).toBeGreaterThan(0);
    for (const { url } of fetched) {
      expect(url, `billable probe: ${url}`).not.toContain('chat/completions');
    }
  });

  it('probes the free usage endpoint with a GET', async () => {
    const { fetched } = await runConnectionTest(ZERO_REMAINING);
    expect(fetched).toEqual([{ url: 'https://opencode.ai/zen/go/v1/usage', method: 'GET' }]);
  });

  it('reports a key with zero remaining quota as valid', async () => {
    const { result } = await runConnectionTest(ZERO_REMAINING);
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it.each([401, 403, 404])('still rejects the key on %i', async (status) => {
    const { result } = await runConnectionTest({
      ok: false,
      status,
      json: async () => ({}),
      text: async () => '',
    });
    expect(result.valid).toBe(false);
  });
});
