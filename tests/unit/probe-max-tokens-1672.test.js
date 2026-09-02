/**
 * #1672 — a connection test reports a working key as broken.
 *
 * The api-key probes ask the upstream for max_tokens:1. A reasoning model
 * spends that budget on chain-of-thought and emits nothing, and several
 * upstreams reject the value outright, so the probe fails for a credential that
 * is perfectly good. src/app/api/models/test/ping.js already raised its own
 * probe to 1024 for exactly this (#3010); these bodies were left behind.
 *
 * The floor lives in one place so the two probes cannot drift apart again.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: vi.fn() }));

const originalDataDir = process.env.DATA_DIR;
let dataDir;
let testSingleConnection;
let repo;
let proxyFetch;
let PROBE_MAX_TOKENS;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'tokenproxy-probe-tokens-1672-'));
  process.env.DATA_DIR = dataDir;
  ({ testSingleConnection } = await import('../../src/app/api/providers/[id]/test/testUtils.js'));
  repo = await import('../../src/lib/db/repos/connectionsRepo.js');
  ({ proxyAwareFetch: proxyFetch } = await import('open-sse/utils/proxyFetch.js'));
  ({ PROBE_MAX_TOKENS } = await import('open-sse/config/runtimeConfig.js'));
});

afterEach(() => proxyFetch.mockReset());

afterAll(() => {
  delete global._dbAdapter;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

// Answers 200 for a listing and 400 for a chat call (400 still confirms the
// credential), recording every JSON body sent.
function recordingFetch(bodies, getStatus = 200) {
  return async (url, options = {}) => {
    if (options.body) {
      try {
        bodies.push(JSON.parse(options.body));
      } catch {
        bodies.push(null);
      }
    }
    return new Response('{}', { status: options.method === 'POST' ? 400 : getStatus });
  };
}

async function probeBodies(provider, extra = {}, getStatus = 200) {
  const bodies = [];
  proxyFetch.mockImplementation(recordingFetch(bodies, getStatus));
  const conn = await repo.createProviderConnection({
    provider,
    authType: 'apikey',
    name: `${provider} ${Math.random()}`,
    apiKey: 'sk-real',
    ...extra,
  });
  await testSingleConnection(conn.id);
  return bodies;
}

describe('a credential probe asks for a usable token budget (#1672)', () => {
  it('keeps the floor at the value ping.js already settled on', () => {
    expect(PROBE_MAX_TOKENS).toBeGreaterThanOrEqual(1024);
  });

  it.each([
    ['anthropic', {}],
    ['minimax', {}],
    ['glm', {}],
  ])('%s asks for the shared floor, not one token', async (provider, extra) => {
    const bodies = await probeBodies(provider, extra);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) expect(body.max_tokens).toBe(PROBE_MAX_TOKENS);
  });

  it('kimi spends nothing at all on an api-key probe', async () => {
    // A platform key is not valid on the subscription host, so this mode reads
    // the balance endpoint instead of posting a chat call. No POST means no
    // token budget to get wrong, which is stronger than the floor above.
    const bodies = await probeBodies('kimi', {});
    expect(bodies).toEqual([]);
  });

  it('a hand-added OpenAI-compatible endpoint gets the same budget', async () => {
    // 404 on the listing is what sends this provider to the chat probe (#994).
    const bodies = await probeBodies(
      'openai-compatible-probe',
      { providerSpecificData: { baseUrl: 'https://gw.example.test/v1' } },
      404,
    );
    expect(bodies).toHaveLength(1);
    expect(bodies[0].max_tokens).toBe(PROBE_MAX_TOKENS);
  });

  it('Azure uses the same floor on its own parameter name', async () => {
    const bodies = await probeBodies('azure', {
      providerSpecificData: { azureEndpoint: 'https://az.example.test', deployment: 'gpt-4' },
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0].max_completion_tokens).toBe(PROBE_MAX_TOKENS);
  });
});
