import { describe, it, expect } from 'vitest';
import { runQuotaAutoPingTick } from '@/shared/services/quotaAutoPing';
import { QUOTA_AUTOPING_CONFIG } from '@/shared/constants/config';

// Every provider with warming enabled in settings must be ENUMERATED by the
// tick. The scheduler used to skip a provider whose settings key nothing had
// ever written, which is how antigravity and kimi stayed cold while carrying
// full config, a usage reader and a working executor.
const PROVIDERS = Object.keys(QUOTA_AUTOPING_CONFIG.providers);

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
    resolveConnectionProxyConfig: async () => null,
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
