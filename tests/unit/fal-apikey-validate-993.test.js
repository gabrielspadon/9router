/**
 * #993 — entering an API key for fal never worked.
 *
 * fal-ai is image-only and its imageConfig declares a baseUrl and nothing else,
 * so the generic media probe could not build an auth header and returned null,
 * meaning "let the default branch decide". The default branch only knows
 * OpenAI-compatible chat providers, so it answered 400 "Provider validation not
 * supported" — which the add-key modal renders as "Invalid" for every key the
 * user types, no matter how good the key is.
 *
 * fal is not alone in that config shape (stability-ai, recraft, runwayml,
 * comfyui, sdwebui), so these pin the class, and pin that a media provider that
 * DOES declare an auth scheme is still probed for real rather than waved
 * through.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const originalDataDir = process.env.DATA_DIR;
let dataDir;
const originalFetch = global.fetch;
let POST;

function validateRequest(payload) {
  return new Request('http://localhost/api/providers/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'tokenproxy-validate-993-'));
  process.env.DATA_DIR = dataDir;
  ({ POST } = await import('../../src/app/api/providers/validate/route.js'));
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

afterAll(() => {
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe('POST /api/providers/validate for image-only providers', () => {
  it("accepts a fal key instead of answering 'validation not supported'", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock;

    const res = await POST(validateRequest({ provider: 'fal-ai', apiKey: 'uuid:deadbeef' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.valid).toBe(true);
    expect(body.error).toBeNull();
    // Nothing is probed, so nothing can be misread as a rejection.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts the same shape for the other image providers with no declared auth scheme', async () => {
    global.fetch = vi.fn();

    for (const provider of ['stability-ai', 'recraft']) {
      const res = await POST(validateRequest({ provider, apiKey: 'k' }));
      expect(res.status, provider).toBe(200);
      expect((await res.json()).valid, provider).toBe(true);
    }
  });

  it('still rejects a bad key for a media provider that declares its auth scheme', async () => {
    global.fetch = vi.fn(async () => new Response('no', { status: 401 }));

    const res = await POST(validateRequest({ provider: 'deepgram', apiKey: 'bad' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.valid).toBe(false);
    expect(global.fetch).toHaveBeenCalled();
  });

  it('still refuses a request with no key at all', async () => {
    const res = await POST(validateRequest({ provider: 'fal-ai' }));
    expect(res.status).toBe(400);
  });
});
