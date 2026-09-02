import { describe, it, expect, vi, beforeEach } from 'vitest';

// PR #3190. api.kimi.com/coding is the Kimi Code SUBSCRIPTION product and rejects a
// platform API key with 401 however valid that key is — the same asymmetry #2881
// fixed for ROUTING (kimi.js scopes its transports with authModes). The connection
// test never got the same treatment, so it probed the subscription host for every
// credential and told users their working platform key was invalid. The validator
// has to branch on the credential's auth mode exactly as the transport table does.

const SUBSCRIPTION_HOST = 'api.kimi.com';
const PLATFORM_BALANCE_URL = 'https://api.moonshot.ai/v1/users/me/balance';

function kimiConnection(authType) {
  return {
    id: 'conn_kimi',
    provider: 'kimi',
    authType,
    apiKey: 'sk-platform-key',
    providerSpecificData: {},
  };
}

async function runConnectionTest(authType) {
  const fetched = [];
  vi.doMock('@/lib/localDb', () => ({
    getProviderConnectionById: vi.fn(async () => kimiConnection(authType)),
    updateProviderConnection: vi.fn(async () => ({})),
  }));
  vi.doMock('@/lib/network/connectionProxy', () => ({
    resolveConnectionProxyConfig: vi.fn(async () => ({ kind: 'none' })),
    toConnectionProxyOptions: vi.fn(() => ({})),
  }));
  vi.doMock('open-sse/utils/proxyFetch.js', () => ({
    proxyAwareFetch: vi.fn(async (url, options) => {
      fetched.push({ url: String(url), method: options?.method || 'GET' });
      return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
    }),
  }));

  const { testSingleConnection } =
    await import('../../src/app/api/providers/[id]/test/testUtils.js');
  const result = await testSingleConnection('conn_kimi');
  return { result, fetched };
}

describe('the Kimi connection test probes the host matching the credential (#3190)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('validates a platform API key against the platform balance endpoint', async () => {
    const { result, fetched } = await runConnectionTest('apikey');
    expect(fetched).toEqual([{ url: PLATFORM_BALANCE_URL, method: 'GET' }]);
    expect(result.valid).toBe(true);
  });

  it('never sends an API key to the subscription host', async () => {
    const { fetched } = await runConnectionTest('apikey');
    for (const { url } of fetched) {
      expect(url, `platform key probed the subscription host: ${url}`).not.toContain(
        SUBSCRIPTION_HOST
      );
    }
  });

  it('leaves the subscription probe untouched for a subscription credential', async () => {
    // "cookie" is the non-apikey mode that reaches this validator; an oauth
    // credential is answered by the OAuth path before it ever gets here.
    const { result, fetched } = await runConnectionTest('cookie');
    expect(fetched).toEqual([{ url: 'https://api.kimi.com/coding/v1/messages', method: 'POST' }]);
    expect(result.valid).toBe(true);
  });
});
