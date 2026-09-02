// #1365 — the shortened tunnel link 404s while the direct *.trycloudflare.com
// URL serves fine. registerTunnelUrl() called the relay and never read the
// status: fetch resolves for a 404 or a 500 too, so a mapping the relay refused
// still produced a short link the dashboard offered.
//
// The same relay dependence reached the watchdog, which treated a third party's
// downtime as proof that this tunnel had died and respawned cloudflared for it,
// rotating a working quick-tunnel URL out from under every client.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const state = { current: null };

vi.mock('@/lib/tunnel/shared/state.js', () => ({
  loadState: () => state.current,
  saveState: (next) => {
    state.current = next;
  },
  generateShortId: () => 'abc123',
}));

const workerFetch = vi.fn();
vi.mock('@/lib/tunnel/cloudflare/workerFetch.js', () => ({
  workerFetch: (...args) => workerFetch(...args),
}));

const probeUrlAlive = vi.fn();
vi.mock('@/lib/tunnel/cloudflare/healthCheck.js', () => ({
  probeUrlAlive: (...args) => probeUrlAlive(...args),
  waitForHealth: async (urls) => (Array.isArray(urls) ? urls : [urls]).filter(Boolean)[0],
}));

vi.mock('@/lib/tunnel/cloudflare/cloudflared.js', () => ({
  isCloudflaredRunning: () => false,
  killCloudflared: () => {},
  setUnexpectedExitHandler: () => {},
  spawnQuickTunnel: async () => ({ tunnelUrl: 'https://direct-tunnel.trycloudflare.com' }),
}));

vi.mock('@/lib/tunnel/cloudflare/pid.js', () => ({ clearPid: () => {} }));

vi.mock('@/lib/localDb', () => ({
  getSettings: async () => ({ tunnelEnabled: true }),
  updateSettings: async () => {},
}));

const { enableTunnel, getTunnelStatus, isTunnelReachable } =
  await import('@/lib/tunnel/cloudflare/manager.js');

const accepted = () => new Response('{}', { status: 200 });
const refused = () => new Response('no such short id', { status: 404 });

beforeEach(() => {
  state.current = null;
  workerFetch.mockReset();
  probeUrlAlive.mockReset();
});

describe('short link registration (#1365)', () => {
  it('withholds the short link when the relay refuses the registration', async () => {
    workerFetch.mockResolvedValue(refused());
    probeUrlAlive.mockResolvedValue(true);

    const result = await enableTunnel(20128);

    // The tunnel itself is up, so enable succeeds on the direct URL.
    expect(result.success).toBe(true);
    expect(result.tunnelUrl).toBe('https://direct-tunnel.trycloudflare.com');
    // The link the relay never accepted is not offered.
    expect(result.publicUrl).toBe('');
    expect(state.current.registered).toBe(false);
  });

  it('offers the short link once the relay accepts it', async () => {
    workerFetch.mockResolvedValue(accepted());
    probeUrlAlive.mockResolvedValue(true);

    const result = await enableTunnel(20128);

    expect(result.publicUrl).toBe('https://rabc123.abc-tunnel.us');
    expect(state.current.registered).toBe(true);
  });

  it('reports the short link only for a mapping the relay serves', async () => {
    state.current = { shortId: 'abc123', tunnelUrl: 'https://direct.trycloudflare.com' };
    expect((await getTunnelStatus()).publicUrl).toBe('');

    state.current = { ...state.current, registered: true };
    expect((await getTunnelStatus()).publicUrl).toBe('https://rabc123.abc-tunnel.us');
  });
});

describe('relay downtime is not this tunnel dying (#1365)', () => {
  beforeEach(() => {
    state.current = {
      shortId: 'abc123',
      tunnelUrl: 'https://direct.trycloudflare.com',
      registered: true,
    };
  });

  it('keeps a serving tunnel alive when only the relay is unreachable', async () => {
    probeUrlAlive.mockImplementation(async (url) => !url.includes('abc-tunnel.us'));
    workerFetch.mockResolvedValue(accepted());

    // Reachable, so the watchdog does not restart cloudflared and rotate the URL.
    expect(await isTunnelReachable()).toBe(true);
    // The link is withheld until the relay answers for it again...
    expect(state.current.registered).toBe(false);
    // ...and the mapping is re-sent rather than waiting for a manual re-enable.
    expect(workerFetch).toHaveBeenCalledWith(
      'https://abc-tunnel.us/api/tunnel/register',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('still reports a dead direct URL as unreachable', async () => {
    probeUrlAlive.mockImplementation(async (url) => url.includes('abc-tunnel.us'));
    expect(await isTunnelReachable()).toBe(false);
  });

  it('restores the short link on its own once the relay answers again', async () => {
    state.current = { ...state.current, registered: false };
    probeUrlAlive.mockResolvedValue(true);

    expect(await isTunnelReachable()).toBe(true);
    expect(state.current.registered).toBe(true);
    expect(workerFetch).not.toHaveBeenCalled();
  });
});
