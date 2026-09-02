import { describe, it, expect, afterEach, vi } from 'vitest';

// A backend that could not answer is not a backend that measured zero. The
// route used to swallow the failure and reply 200 with an all-zero body, which
// reads on the page as "the token saver saved nothing today" and leaves the
// client's honest unavailable branch permanently unreachable.

function makeReq(query = '') {
  const url = `http://localhost:20128/api/token-saver/stats${query}`;
  return {
    url,
    headers: new Headers({ host: 'localhost:20128' }),
    nextUrl: { searchParams: new URL(url).searchParams },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('GET /api/token-saver/stats when the read model throws', () => {
  it('fails loudly instead of replying 200 with zeroed windows', async () => {
    vi.resetModules();
    vi.doMock('@/lib/tokenSaver/events.js', () => ({
      getTokenSaverStats: () => {
        throw new Error('events store unreadable');
      },
    }));
    const { GET } = await import('@/app/api/token-saver/stats/route.js');
    const res = await GET(makeReq());

    expect(res.status).toBe(503);
    const body = await res.json();
    // Nothing in the reply may be mistaken for a measurement.
    expect(body.windows).toBeUndefined();
    expect(body.timeline).toBeUndefined();
    expect(JSON.stringify(body)).not.toMatch(/"requests":\s*0/);
    expect(body.error).toBeTruthy();
  });

  it('does not leak the underlying failure text to the client', async () => {
    vi.resetModules();
    vi.doMock('@/lib/tokenSaver/events.js', () => ({
      getTokenSaverStats: () => {
        throw new Error('/home/someone/.tokenproxy/db/data.sqlite is locked');
      },
    }));
    const { GET } = await import('@/app/api/token-saver/stats/route.js');
    const res = await GET(makeReq());
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toMatch(/\.tokenproxy|sqlite|locked/i);
  });
});
