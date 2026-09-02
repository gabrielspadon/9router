import { describe, expect, it } from 'vitest';
import REGISTRY from '../../open-sse/providers/registry/index.js';
import { getSyncTargets } from '../../src/shared/services/freeModelSync.js';

// #1995 "Kilo Code free models not available in combo model selector": the
// registry prerequisite (modelsFetcher + passthroughModels) landed in
// open-sse/providers/registry/kilocode.js first, then a follow-up pass widened
// src/shared/services/freeModelSync.js's getSyncTargets() to also accept an
// "oauth" provider whose modelsFetcher.type is itself a "*-free" filter
// contract. kilocode qualifies (type "openrouter-free", endpoint verified
// public/unauthenticated), so it now reaches the sync loop that populates
// customModels, which is what ModelSelectModal.js reads for a
// passthroughModels provider.

const kilocode = () => REGISTRY.find((r) => r.id === 'kilocode');

describe('#1995 kilocode registry prerequisite', () => {
  it('declares a modelsFetcher for the full gateway catalog', () => {
    expect(kilocode().modelsFetcher).toEqual({
      url: 'https://api.kilo.ai/api/gateway/models',
      type: 'openrouter-free',
    });
  });

  it('opts into passthroughModels', () => {
    expect(kilocode().passthroughModels).toBe(true);
  });

  it('category stays oauth (chat still needs a real device-code token), but now syncs', () => {
    // Category is unchanged deliberately: kilocode's connect flow is real
    // OAuth and the UI reads category to show that. What changed is that
    // getSyncTargets() no longer requires category "free"/"freeTier" alone —
    // an "oauth" entry with a "*-free" modelsFetcher.type qualifies too,
    // because that contract already means the fetched catalog is filtered to
    // zero-priced models before it ever reaches customModels.
    expect(kilocode().category).toBe('oauth');
    const targetIds = getSyncTargets().map((t) => t.id);
    expect(targetIds).toContain('kilocode');
  });
});
