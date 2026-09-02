/**
 * #3649 — GET /v1/models/cc/claude-sonnet-5 never reaches the handler.
 *
 * #3588 taught the kind route to answer a single-model lookup, but the segment
 * is declared as [kind], which matches exactly one path segment. Every model id
 * this gateway publishes is provider-prefixed ("cc/claude-sonnet-5"), so the
 * ids a client reads out of GET /v1/models are precisely the ones the lookup
 * cannot be asked about: Next matches no route and answers 404 before the
 * handler runs.
 *
 * The route is a catch-all, and the eight kind slugs still resolve as before.
 */
import { describe, expect, it, vi } from 'vitest';

const MODELS = [
  { id: 'cc/claude-sonnet-5', object: 'model', owned_by: 'cc' },
  { id: 'cx/gpt-5.6', object: 'model', owned_by: 'cx' },
  { id: 'gpt-4o', object: 'model', owned_by: 'openai' },
  { id: 'cf/whisper', object: 'model', owned_by: 'cf' },
];
vi.mock('@/app/api/v1/models/route.js', () => ({
  buildModelsList: async (kinds) => {
    if (!Array.isArray(kinds)) throw new TypeError('buildModelsList requires a kind list');
    return MODELS;
  },
}));

const { GET } = await import('@/app/api/v1/models/[...kind]/route.js');

// Next hands a catch-all its segments as an array.
const get = (...segments) =>
  GET(new Request('http://x/v1/models/' + segments.join('/')), {
    params: Promise.resolve({ kind: segments }),
  });

describe('GET /v1/models/{provider}/{model} resolves one model (#3649)', () => {
  it('a provider-prefixed id returns that model', async () => {
    const res = await get('cc', 'claude-sonnet-5');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('cc/claude-sonnet-5');
    expect(body.object).toBe('model');
    expect(body.data).toBeUndefined();
  });

  it('a bare id still resolves, so the #3588 behaviour is unchanged', async () => {
    expect((await (await get('gpt-4o')).json()).id).toBe('gpt-4o');
  });

  it('the last segment of a prefixed id still resolves', async () => {
    expect((await (await get('whisper')).json()).id).toBe('cf/whisper');
  });

  it('a kind slug still returns a list', async () => {
    const res = await get('embedding');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe('list');
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('a kind slug is not treated as a prefix for a longer path', async () => {
    // "image/whatever" is neither a kind nor a model id, and must not fall back
    // to the image list just because its first segment is a kind slug.
    const res = await get('image', 'whatever');
    expect(res.status).toBe(404);
  });

  it('an unknown prefixed id 404s, naming both cases', async () => {
    const res = await get('cc', 'no-such-model');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.message).toContain('Unknown model or kind');
    expect(body.error.message).toContain('cc/no-such-model');
  });
});
