/**
 * #1450 — a connection test can hang for as long as the upstream keeps the
 * socket open.
 *
 * Most probes in testUtils.js already bound themselves with
 * FETCH_CONNECT_TIMEOUT_MS, but the plain api-key cases (openai,
 * vercel-ai-gateway, deepseek, …) passed no signal at all, and proxyAwareFetch
 * adds none of its own. Both Ollama cases were worse: they called the global
 * fetch directly, so they skipped the connection proxy as well as the deadline.
 *
 * Connection tests run one after another, so a single black-holed provider
 * stalls every connection queued behind it.
 */
process.env.FETCH_CONNECT_TIMEOUT_MS = '150';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch: vi.fn() }));

const originalDataDir = process.env.DATA_DIR;
const originalFetch = global.fetch;
let dataDir;
let testSingleConnection;
let repo;
let proxyFetch;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'tokenproxy-abort-1450-'));
  process.env.DATA_DIR = dataDir;
  ({ testSingleConnection } = await import('../../src/app/api/providers/[id]/test/testUtils.js'));
  repo = await import('../../src/lib/db/repos/connectionsRepo.js');
  ({ proxyAwareFetch: proxyFetch } = await import('open-sse/utils/proxyFetch.js'));
});

afterEach(() => {
  global.fetch = originalFetch;
  proxyFetch.mockReset();
});

afterAll(() => {
  delete global._dbAdapter;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

function seed(provider, extra = {}) {
  return repo.createProviderConnection({
    provider,
    authType: 'apikey',
    name: `${provider} ${Math.random()}`,
    apiKey: 'sk-real',
    ...extra,
  });
}

// Never answers; resolves only if the caller aborts it.
function blackHole(seen) {
  return (url, options = {}) => {
    seen.push({ url: String(url), options });
    return new Promise((_, reject) => {
      const signal = options.signal;
      if (!signal) return;
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  };
}

describe('a connection probe is bounded by an abort signal (#1450)', () => {
  it('passes an abort signal on the plain api-key path', async () => {
    const seen = [];
    proxyFetch.mockImplementation(async (url, options = {}) => {
      seen.push({ url: String(url), options });
      return new Response('{}', { status: 200 });
    });

    const conn = await seed('openai');
    await testSingleConnection(conn.id);

    expect(seen).toHaveLength(1);
    expect(seen[0].options.signal).toBeInstanceOf(AbortSignal);
  });

  it('routes the Ollama probes through the proxy-aware fetch, with a signal', async () => {
    const seen = [];
    proxyFetch.mockImplementation(async (url, options = {}) => {
      seen.push({ url: String(url), options });
      return new Response('{}', { status: 200 });
    });
    global.fetch = () => {
      throw new Error('ollama probe bypassed the connection proxy');
    };

    const hosted = await seed('ollama');
    const local = await seed('ollama-local');
    await testSingleConnection(hosted.id);
    await testSingleConnection(local.id);

    expect(seen).toHaveLength(2);
    for (const call of seen) expect(call.options.signal).toBeInstanceOf(AbortSignal);
  });

  it('gives up on a black-holed upstream instead of hanging', async () => {
    const seen = [];
    proxyFetch.mockImplementation(blackHole(seen));

    const conn = await seed('openai');
    const result = await testSingleConnection(conn.id);

    expect(result.valid).toBe(false);
    expect(seen).toHaveLength(1);
    expect(seen[0].options.signal.aborted).toBe(true);
  }, 3000);
});
