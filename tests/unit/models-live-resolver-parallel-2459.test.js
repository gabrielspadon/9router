/**
 * #2459 — GET /v1/models is slow in proportion to how many providers you have
 * connected.
 *
 * buildModelsList awaits the cursor proxy resolution and the live catalog
 * resolver inside one sequential per-provider for-of. Each of those is an
 * upstream round trip that routinely takes seconds, so the wait is their sum:
 * connect eight providers with live catalogs and the listing takes as long as
 * all eight upstreams added together, and a client that polls /v1/models on
 * start-up sits there for it.
 *
 * Nothing about the loop needs them serialized. Starting each provider's
 * lookups before the loop lets them overlap while every provider keeps its own
 * outcome, so one failing upstream still costs only its own catalog.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/localDb', () => ({
  getProviderConnections: vi.fn().mockResolvedValue([]),
  getCombos: vi.fn().mockResolvedValue([]),
  getCustomModels: vi.fn().mockResolvedValue([]),
  getModelAliases: vi.fn().mockResolvedValue({}),
  getFreeModels: vi.fn().mockResolvedValue({}),
  getSettings: vi.fn().mockResolvedValue({}),
  updateConnectionProxyPoolSnapshotIfBound: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/disabledModelsDb', () => ({
  getDisabledModels: vi.fn().mockResolvedValue({}),
}));
vi.mock('open-sse/services/kiroModels.js', () => ({ resolveKiroModels: vi.fn() }));
vi.mock('open-sse/services/qoderModels.js', () => ({ resolveQoderModels: vi.fn() }));

const { getProviderConnections } = await import('@/lib/localDb');
const { resolveKiroModels } = await import('open-sse/services/kiroModels.js');
const { resolveQoderModels } = await import('open-sse/services/qoderModels.js');
const { buildModelsList } = await import('@/app/api/v1/models/route.js');

const CONNECTIONS = [
  { id: 'k1', provider: 'kiro', isActive: true, accessToken: 't', providerSpecificData: {} },
  { id: 'q1', provider: 'qoder', isActive: true, accessToken: 't', providerSpecificData: {} },
];

const ids = (list) => list.map((m) => m.id);

// Both resolvers must be in flight at once to get past this gate. Under
// sequential awaits the first one waits out the fuse and throws instead.
function makeRendezvous(expected, fuseMs = 500) {
  let arrived = 0;
  let open;
  const bothIn = new Promise((resolve) => {
    open = resolve;
  });
  return async function rendezvous() {
    if (++arrived === expected) open();
    let fuse;
    try {
      await Promise.race([
        bothIn,
        new Promise((_, reject) => {
          fuse = setTimeout(() => reject(new Error('resolvers ran one after another')), fuseMs);
        }),
      ]);
    } finally {
      clearTimeout(fuse);
    }
  };
}

describe('/v1/models resolves live catalogs concurrently (#2459)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProviderConnections.mockResolvedValue(CONNECTIONS);
  });

  it('holds two providers in flight at the same time', async () => {
    const rendezvous = makeRendezvous(2);
    resolveKiroModels.mockImplementation(async () => {
      await rendezvous();
      return { models: [{ id: 'kiro-live-1' }] };
    });
    resolveQoderModels.mockImplementation(async () => {
      await rendezvous();
      return { models: [{ id: 'qoder-live-1', name: 'Qoder Live' }] };
    });

    const listed = ids(await buildModelsList(['llm']));

    expect(listed).toContain('kr/kiro-live-1');
    expect(listed).toContain('qd/qoder-live-1');
  });

  it('isolates a failing provider: its neighbour still gets its live catalog', async () => {
    resolveKiroModels.mockRejectedValue(new Error('kiro upstream down'));
    resolveQoderModels.mockResolvedValue({ models: [{ id: 'qoder-live-1' }] });

    const listed = ids(await buildModelsList(['llm']));

    expect(listed).toContain('qd/qoder-live-1');
    // Fail open: kiro falls back to its static registry rather than vanishing.
    expect(listed.some((id) => id.startsWith('kr/'))).toBe(true);
    expect(listed).not.toContain('kr/kiro-live-1');
  });

  it('a required proxy that is unavailable still fails the whole listing', async () => {
    const err = Object.assign(new Error('Required proxy is unavailable'), {
      code: 'required_proxy_unavailable',
    });
    resolveKiroModels.mockRejectedValue(err);
    resolveQoderModels.mockResolvedValue({ models: [{ id: 'qoder-live-1' }] });

    await expect(buildModelsList(['llm'])).rejects.toMatchObject({
      code: 'required_proxy_unavailable',
    });
  });
});
