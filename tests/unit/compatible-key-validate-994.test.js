/**
 * #994 — a manually added provider is reported as having an invalid API key.
 *
 * A custom OpenAI-compatible endpoint was judged solely on GET {baseUrl}/models:
 * `isValid = res.ok` when adding it, and `valid: res.ok` when testing it later.
 * Gateways that expose no listing (the reporter's AgentRoute among them) answer
 * 404 or 405 there while /chat/completions works perfectly, so every key added
 * by hand was declared invalid on both screens.
 *
 * The fix is the shape the custom-embedding branch of the same route already
 * used: only 401/403 is definitive from the listing, anything else re-probes the
 * endpoint the connection will actually use. A 404 from the chat probe still
 * fails, because there it means the base URL or model is wrong (#2032).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/models', () => ({ getProviderNodeById: vi.fn() }));
vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: vi.fn() }));

const originalDataDir = process.env.DATA_DIR;
const originalFetch = global.fetch;
let dataDir;
let POST;
let models;
let testSingleConnection;
let repo;
let proxyFetch;

const PROVIDER = 'openai-compatible-agentroute';
const BASE_URL = 'https://agentroute.example.test/v1';

function validateRequest(payload) {
  return new Request('http://localhost/api/providers/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// Answers each URL by the first matching fragment, and records the call order.
function routedFetch(routes, calls) {
  return async (url) => {
    calls.push(String(url));
    for (const [fragment, status] of Object.entries(routes)) {
      if (String(url).includes(fragment)) return new Response('{}', { status });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'tokenproxy-validate-994-'));
  process.env.DATA_DIR = dataDir;
  models = await import('@/models');
  ({ POST } = await import('../../src/app/api/providers/validate/route.js'));
  ({ testSingleConnection } = await import('../../src/app/api/providers/[id]/test/testUtils.js'));
  repo = await import('../../src/lib/db/repos/connectionsRepo.js');
  ({ proxyAwareFetch: proxyFetch } = await import('open-sse/utils/proxyFetch.js'));
  models.getProviderNodeById.mockResolvedValue({ id: PROVIDER, baseUrl: BASE_URL });
});

afterEach(() => {
  global.fetch = originalFetch;
});

afterAll(() => {
  delete global._dbAdapter;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe('adding a hand-added OpenAI-compatible endpoint', () => {
  it('accepts a working key when the gateway serves no /models', async () => {
    const calls = [];
    global.fetch = routedFetch({ '/models': 404, '/chat/completions': 400 }, calls);

    const res = await POST(validateRequest({ provider: PROVIDER, apiKey: 'sk-real' }));
    const body = await res.json();

    expect(body.valid).toBe(true);
    expect(body.error).toBeNull();
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('/chat/completions');
  });

  it('treats 401 from the listing as definitive and does not probe further', async () => {
    const calls = [];
    global.fetch = routedFetch({ '/models': 401 }, calls);

    const res = await POST(validateRequest({ provider: PROVIDER, apiKey: 'sk-bad' }));
    const body = await res.json();

    expect(body.valid).toBe(false);
    expect(body.error).toBe('Invalid API key');
    expect(calls).toHaveLength(1);
  });

  it('still fails when the chat endpoint is missing too, so a wrong base URL is caught', async () => {
    const calls = [];
    global.fetch = routedFetch({ '/models': 404, '/chat/completions': 404 }, calls);

    const res = await POST(validateRequest({ provider: PROVIDER, apiKey: 'sk-real' }));
    const body = await res.json();

    expect(body.valid).toBe(false);
    expect(body.error).toBe('Invalid API key or base URL');
  });

  it('keeps the single-call path when the listing works', async () => {
    const calls = [];
    global.fetch = routedFetch({ '/models': 200 }, calls);

    const res = await POST(validateRequest({ provider: PROVIDER, apiKey: 'sk-real' }));

    expect((await res.json()).valid).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe('testing a saved connection to that endpoint', () => {
  async function seed() {
    return repo.createProviderConnection({
      provider: PROVIDER,
      authType: 'apikey',
      name: `AgentRoute ${Math.random()}`,
      apiKey: 'sk-real',
      providerSpecificData: { baseUrl: BASE_URL },
    });
  }

  it('reports the connection healthy when only the listing is missing', async () => {
    const conn = await seed();
    const calls = [];
    proxyFetch.mockImplementation(routedFetch({ '/models': 404, '/chat/completions': 400 }, calls));

    const result = await testSingleConnection(conn.id);

    expect(result.valid).toBe(true);
    expect(calls[1]).toContain('/chat/completions');
    expect((await repo.getProviderConnectionById(conn.id)).testStatus).toBe('active');
  });

  it('still reports a rejected key as an error', async () => {
    const conn = await seed();
    proxyFetch.mockImplementation(routedFetch({ '/models': 401 }, []));

    const result = await testSingleConnection(conn.id);

    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid API key');
  });
});
