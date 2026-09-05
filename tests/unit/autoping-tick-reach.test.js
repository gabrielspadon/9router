import { describe, it, expect } from 'vitest';
import { runQuotaAutoPingTick, cheapestPingModel } from '@/shared/services/quotaAutoPing';
import { QUOTA_AUTOPING_CONFIG } from '@/shared/constants/config';

// Every provider with warming enabled in settings must be ENUMERATED by the
// tick. The scheduler used to skip a provider whose settings key nothing had
// ever written, which is how antigravity and kimi stayed cold while carrying
// full config, a usage reader and a working executor.
const PROVIDERS = Object.keys(QUOTA_AUTOPING_CONFIG.providers);

// The real resolver never returns null; "no proxy configured" resolves to an
// intentional-direct shape. A stub returning null would have licensed a
// `cfg?.` guard in buildProxyOptions that downgrades a strict-proxy
// connection to direct egress.
const DIRECT_PROXY_CONFIG = {
  kind: 'usable',
  resolutionKind: 'intentional-direct',
  connectionProxyEnabled: false,
  connectionProxyUrl: '',
  connectionNoProxy: '',
  vercelRelayUrl: '',
  strictProxy: false,
};

function depsFor(providers) {
  const seen = [];
  const settings = {};
  for (const p of providers) {
    settings[QUOTA_AUTOPING_CONFIG.providers[p].settingsKey] = {
      enabled: true,
      connections: { [`${p}-1`]: true },
    };
  }
  return [seen, {
    getSettings: async () => settings,
    getProviderConnections: async ({ provider }) => {
      seen.push(provider);
      return [{
        id: `${provider}-1`,
        provider,
        authType: (QUOTA_AUTOPING_CONFIG.providers[provider].authTypes || ['oauth'])[0],
        providerSpecificData: {},
      }];
    },
    resolveConnectionProxyConfig: async () => DIRECT_PROXY_CONFIG,
    refreshAndUpdateCredentials: async (connection) => ({ connection }),
    updateProviderConnection: async () => {},
    getUsageForProvider: async () => ({ quotas: {} }),
    executeRequest: async () => ({}),
  }];
}

const freshState = () => ({
  running: false, failureCache: {}, resetCache: {}, seenResets: {}, allRunning: {},
});

describe('quota warming tick reaches every configured provider', () => {
  it.each(PROVIDERS)('%s is enumerated when its setting is on', async (provider) => {
    const [seen, deps] = depsFor([provider]);
    await runQuotaAutoPingTick(deps, freshState());
    expect(seen).toContain(provider);
  });

  it('a provider with no setting written is skipped, not enumerated', async () => {
    const [seen, deps] = depsFor([PROVIDERS[0]]);
    await runQuotaAutoPingTick(deps, freshState());
    expect(seen).toEqual([PROVIDERS[0]]);
  });
});

// ENUMERATION IS NOT WARMING. The suite above proves the tick LOOKS at every
// provider; it cannot tell a provider that had nothing to warm from one that
// reached its sender and could not use it. A cold connection — no quota family
// reported at all, which is exactly the stopped clock warming exists to start —
// must produce one real upstream request per provider, through whichever sender
// that provider owns. kimi and antigravity carry no bespoke sender, so this is
// the only check that the generic executor path is reachable for them.
function warmProbeDeps(provider) {
  const cfg = QUOTA_AUTOPING_CONFIG.providers[provider];
  const sent = [];
  const okResponse = { ok: true, status: 200, text: async () => '', body: null };
  return [sent, {
    getSettings: async () => ({
      [cfg.settingsKey]: { enabled: true, connections: { [`${provider}-1`]: true } },
    }),
    getProviderConnections: async () => [{
      id: `${provider}-1`,
      provider,
      authType: (cfg.authTypes || ['oauth'])[0],
      accessToken: 'tok',
      providerSpecificData: {},
    }],
    resolveConnectionProxyConfig: async () => DIRECT_PROXY_CONFIG,
    refreshAndUpdateCredentials: async (connection) => ({ connection }),
    updateProviderConnection: async () => {},
    // No quota family reported: every expected window reads absent, which is
    // the state an idle account sits in and the one warming has to break.
    getUsageForProvider: async () => ({ quotas: {} }),
    getExecutor: () => ({
      execute: async ({ model }) => {
        sent.push(model);
        return { response: okResponse };
      },
    }),
    proxyAwareFetch: async (url) => {
      // claude warms over a direct fetch; codex reads its model catalog the
      // same way and falls back to the configured model when it 404s.
      if (String(url).includes('api.anthropic.com')) {
        sent.push('claude-fetch');
        return okResponse;
      }
      return { ok: false, status: 404, text: async () => '' };
    },
  }];
}

describe('a cold connection actually gets warmed, on every provider', () => {
  it.each(PROVIDERS)('%s sends an upstream warm request', async (provider) => {
    const [sent, deps] = warmProbeDeps(provider);
    await runQuotaAutoPingTick(deps, freshState());
    expect(sent.length).toBeGreaterThan(0);
  });

  it('antigravity pokes one model per quota family, not just the governing one', async () => {
    const [sent, deps] = warmProbeDeps('antigravity');
    await runQuotaAutoPingTick(deps, freshState());
    expect(sent).toEqual(QUOTA_AUTOPING_CONFIG.providers.antigravity.quotaKeys);
  });

  it('kimi warms through the generic executor with its cheapest model', async () => {
    const [sent, deps] = warmProbeDeps('kimi');
    await runQuotaAutoPingTick(deps, freshState());
    expect(sent).toEqual([cheapestPingModel('kimi', QUOTA_AUTOPING_CONFIG.providers.kimi)]);
  });
});
