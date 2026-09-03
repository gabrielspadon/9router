import { beforeEach, describe, expect, it, vi } from 'vitest';

// boundary-contract.json: client.catalog.entry — owner "catalog request
// handler", live_gate "managed catalog returns exactly four clean names".
// TokenProxy's own equivalent of that boundary is GET /api/admin/models: per
// src/lib/admin/policy.js's own comment, it is one of the two operations "an
// edge caller needs BEFORE it has done anything operator-scoped: liveness,
// and the catalog it picks a model from". Exercised at the real route
// handler, never at AI_MODELS or the disabled-list repo directly.
//
// Mutations this file must fail under if reintroduced:
//   - "skip managed catalog filter": a disabled model reappears in the list.
//   - "expose internal route name": a field outside the clean projection
//     {model, provider, fullModel, caps} survives onto a catalog entry.

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => null),
  getDisabledModels: vi.fn(),
  getCapabilitiesForModel: vi.fn(),
}));

// Six entries across three providers, two of them disabled, so the live_gate's
// own count — exactly four clean names — is the literal shape of the fixture
// rather than a coincidence of a bigger list trimmed down after the fact.
// Each entry also carries fields a route reading straight off the record
// (rather than through the clean projection) would leak.
const FIXTURE_MODELS = [
  { provider: 'anthropic', model: 'claude-opus-4-1', internalRouteName: 'lane-anthropic-primary', connectionSecret: 'sk-should-never-leave-1' },
  { provider: 'anthropic', model: 'claude-sonnet-5', internalRouteName: 'lane-anthropic-secondary', connectionSecret: 'sk-disabled-should-never-leave-2' },
  { provider: 'openai', model: 'gpt-5.6-sol', internalRouteName: 'lane-openai-primary', connectionSecret: 'sk-should-never-leave-3' },
  { provider: 'openai', model: 'gpt-5.6-mini', internalRouteName: 'lane-openai-secondary', connectionSecret: 'sk-disabled-should-never-leave-4' },
  { provider: 'groq', model: 'kimi-k3', internalRouteName: 'lane-groq-primary', connectionSecret: 'sk-should-never-leave-5' },
  { provider: 'groq', model: 'qwen-3-8-max', internalRouteName: 'lane-groq-secondary', connectionSecret: 'sk-should-never-leave-6' },
];
const DISABLED = { anthropic: ['claude-sonnet-5'], openai: ['gpt-5.6-mini'] };

vi.mock('@/lib/admin/guard.js', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/disabledModelsDb', () => ({ getDisabledModels: mocks.getDisabledModels }));
// Spread the real module: config.js exports far more than AI_MODELS (APP_CONFIG,
// GITHUB_CONFIG, ...) and a partial mock fails every OTHER file importing this
// module for an export this object does not name.
vi.mock('@/shared/constants/config', async (importOriginal) => ({
  ...(await importOriginal()),
  AI_MODELS: FIXTURE_MODELS,
}));
// getProviderAlias forced to null so the disabled-list key is the literal
// provider id above, not a real alias this file has no business knowing.
vi.mock('@/shared/constants/providers', async (importOriginal) => ({
  ...(await importOriginal()),
  getProviderAlias: () => null,
}));
vi.mock('open-sse/providers/capabilities.js', () => ({
  getCapabilitiesForModel: mocks.getCapabilitiesForModel,
}));

const { GET } = await import('@/app/api/admin/models/route.js');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue(null);
  mocks.getDisabledModels.mockResolvedValue(DISABLED);
  mocks.getCapabilitiesForModel.mockReturnValue({
    vision: false,
    search: false,
    reasoning: false,
    contextWindow: 8000,
    maxOutput: 2000,
  });
});

describe('client.catalog.entry — managed catalog returns exactly four clean names', () => {
  it('returns exactly the four entries the disabled filter leaves standing', async () => {
    const res = await GET({});
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.models).toHaveLength(4);
    expect(body.models.map((m) => m.fullModel).sort()).toEqual([
      'anthropic/claude-opus-4-1',
      'groq/kimi-k3',
      'groq/qwen-3-8-max',
      'openai/gpt-5.6-sol',
    ]);
  });

  it('drops a disabled model rather than listing it (mutation: skip managed catalog filter)', async () => {
    const res = await GET({});
    const body = await res.json();
    const ids = body.models.map((m) => m.fullModel);

    expect(ids).not.toContain('anthropic/claude-sonnet-5');
    expect(ids).not.toContain('openai/gpt-5.6-mini');
  });

  it('positive control: the disabled models are genuinely in the fixture pre-filter', () => {
    // Guards the assertion above from vacuously passing against an empty set:
    // the two ids really are present upstream and only absent because the
    // route's own filter removed them.
    expect(FIXTURE_MODELS.some((m) => m.provider === 'anthropic' && m.model === 'claude-sonnet-5')).toBe(true);
    expect(FIXTURE_MODELS.some((m) => m.provider === 'openai' && m.model === 'gpt-5.6-mini')).toBe(true);
  });

  it('projects every entry to exactly {model, provider, fullModel, caps}, nothing else (mutation: expose internal route name)', async () => {
    const res = await GET({});
    const body = await res.json();

    expect(body.models.length).toBeGreaterThan(0);
    for (const entry of body.models) {
      expect(Object.keys(entry).sort()).toEqual(['caps', 'fullModel', 'model', 'provider']);
      expect(entry).not.toHaveProperty('internalRouteName');
      expect(entry).not.toHaveProperty('connectionSecret');
    }
    expect(JSON.stringify(body)).not.toContain('lane-');
    expect(JSON.stringify(body)).not.toContain('sk-');
  });
});
