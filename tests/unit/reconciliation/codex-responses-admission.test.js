import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// boundary-contract.json: codex.responses.entry — owner "Codex Responses
// managed admission". This file covers the ADMISSION half of the contract's
// live_gate ("... records the explicitly selected connection"): that the
// connection and model a Codex-format request reaches are exactly the ones
// explicitly selected, never a substitute. The PERSISTENCE half — that the
// selected connection survives, redacted, into the stored receipt — is
// tests/unit/reconciliation/codex-responses-receipt.test.js; the two are kept
// in separate files because this one needs @/lib/localDb and @/lib/usageDb.js
// mocked out from under @/sse/handlers/chat.js, while the receipt test needs
// the REAL @/lib/db/index.js driver, and those two requirements do not mix
// safely inside one module-mocked file.
//
// Exercised at POST /v1/responses (src/app/api/v1/responses/route.js), which
// for a non-streaming body is a bare passthrough to
// @/sse/handlers/chat.js#handleChat — same handler client.completion.entry
// covers, same proven harness shape as
// tests/unit/connection-default-model-474.test.js.
//
// Mutations this file must fail under if reintroduced:
//   - "drop exact Codex connection pin": the pinned connection is silently
//     swapped for a different, healthy one instead of refused.
//   - "accept another model": the dispatched model or provider differs from
//     what was explicitly requested.
//   - "retry quota failure on another connection": a quota failure on the
//     pinned connection causes selection to run again against a different
//     connection instead of failing the request.

const authMocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(() => null),
  isValidApiKey: vi.fn(async () => true),
}));
const coreMocks = vi.hoisted(() => ({ handleChatCore: vi.fn() }));
const modelMocks = vi.hoisted(() => ({ getModelInfo: vi.fn(), getComboModels: vi.fn() }));
const settingsMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getProxyPools: vi.fn(),
  getSettings: vi.fn(),
  updateConnectionProxyPoolSnapshotIfBound: vi.fn(),
  updateProviderConnection: vi.fn(),
  updateProviderStrategyProxyPoolSnapshotIfBound: vi.fn(),
  validateApiKey: vi.fn(),
}));
const usageMocks = vi.hoisted(() => ({
  saveRequestUsage: vi.fn(),
  getActiveRequests: vi.fn(async () => []),
}));
const proxyMocks = vi.hoisted(() => ({
  pickProxyPoolId: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  toConnectionProxyOptions: vi.fn((config) => ({
    connectionProxyEnabled: config.connectionProxyEnabled,
    connectionProxyUrl: config.connectionProxyUrl,
    connectionNoProxy: config.connectionNoProxy,
    resolutionKind: config.resolutionKind,
    strictProxy: config.strictProxy,
    vercelRelayUrl: config.vercelRelayUrl,
  })),
}));
const quotaMocks = vi.hoisted(() => ({ evaluateQuota: vi.fn() }));

vi.mock('open-sse/index.js', () => ({}));
vi.mock('@/sse/services/auth.js', () => authMocks);
vi.mock('@/sse/services/model.js', async (importOriginal) => ({
  ...(await importOriginal()),
  ...modelMocks,
}));
vi.mock('@/lib/localDb', () => settingsMocks);
vi.mock('@/lib/network/connectionProxy', () => proxyMocks);
vi.mock('@/sse/services/quotaGuard.js', () => quotaMocks);
vi.mock('@/lib/usageDb.js', () => usageMocks);
vi.mock('@/sse/services/tokenRefresh.js', () => ({
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  updateProviderCredentials: vi.fn(),
}));
vi.mock('@/sse/utils/logger.js', () => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  maskKey: vi.fn(() => '***'),
  request: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('open-sse/handlers/chatCore.js', () => ({ handleChatCore: coreMocks.handleChatCore }));
vi.mock('open-sse/services/combo.js', async (importOriginal) => ({
  ...(await importOriginal()),
  detectRequiredCapabilities: vi.fn(() => []),
  handleComboChat: vi.fn(),
  handleFusionChat: vi.fn(),
}));
vi.mock('open-sse/services/capacityAdapter.js', () => ({
  augmentModelsWithCapacityAdapter: vi.fn((models) => models),
  withCapacityAdapterStripping: vi.fn((handler) => handler),
  getActiveAdapterStrategy: vi.fn(),
}));

let POST;

function codexCredentials(overrides = {}) {
  return {
    connectionId: 'codex-conn-pinned',
    connectionName: 'Codex Primary',
    apiKey: 'provider-secret',
    providerSpecificData: {},
    defaultModel: null,
    ...overrides,
  };
}

function responsesRequest(model, headers = {}) {
  return new Request('http://localhost/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ model, stream: false, input: 'hello' }),
  });
}

function success() {
  return { success: true, response: Response.json({ id: 'resp-1', output: [] }) };
}

beforeAll(async () => {
  ({ POST } = await import('@/app/api/v1/responses/route.js'));
});

beforeEach(() => {
  vi.clearAllMocks();
  settingsMocks.getSettings.mockResolvedValue({
    fallbackStrategy: 'fill-first',
    requireApiKey: false,
    providerThinking: {},
    providerStrategies: {},
    cavemanEnabled: false,
    ponytailEnabled: false,
    ccFilterNaming: false,
  });
  settingsMocks.getProviderConnections.mockResolvedValue([]);
  settingsMocks.getProxyPools.mockResolvedValue([]);
  settingsMocks.updateProviderConnection.mockResolvedValue(undefined);
  proxyMocks.resolveConnectionProxyConfig.mockResolvedValue({
    kind: 'usable',
    connectionProxyEnabled: false,
    connectionProxyUrl: '',
    connectionNoProxy: '',
    proxyPoolId: null,
    resolutionKind: 'unselected',
    strictProxy: false,
    vercelRelayUrl: '',
  });
  quotaMocks.evaluateQuota.mockResolvedValue({ paused: false });
  modelMocks.getComboModels.mockResolvedValue(null);
  modelMocks.getModelInfo.mockResolvedValue({ provider: 'codex', model: 'gpt-5.6-sol' });
  authMocks.getProviderCredentials.mockResolvedValue(codexCredentials());
  authMocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false });
  coreMocks.handleChatCore.mockResolvedValue(success());
});

describe('codex.responses.entry — Codex Responses managed admission', () => {
  it('reaches exactly the requested codex model on the exact pinned connection (live_gate: explicitly selected connection)', async () => {
    const res = await POST(responsesRequest('codex/gpt-5.6-sol', { 'x-connection-id': 'codex-conn-pinned' }));

    expect(res.status).toBe(200);
    const [options] = coreMocks.handleChatCore.mock.calls[0];
    expect(options.modelInfo).toEqual({ provider: 'codex', model: 'gpt-5.6-sol' });
    expect(options.body.model).toBe('codex/gpt-5.6-sol');
    expect(options.connectionId).toBe('codex-conn-pinned');
  });

  it('refuses to substitute a different connection for the exact Codex pin (mutation: drop exact Codex connection pin)', async () => {
    authMocks.getProviderCredentials.mockResolvedValue(codexCredentials({ connectionId: 'codex-conn-OTHER' }));

    const res = await POST(responsesRequest('codex/gpt-5.6-sol', { 'x-connection-id': 'codex-conn-pinned' }));

    expect(res.status).toBe(503);
    expect(coreMocks.handleChatCore).not.toHaveBeenCalled();
  });

  it('dispatches no model other than the one explicitly requested (mutation: accept another model)', async () => {
    modelMocks.getModelInfo.mockResolvedValue({ provider: 'codex', model: 'gpt-5.6-sol' });

    const res = await POST(responsesRequest('codex/gpt-5.6-sol', { 'x-connection-id': 'codex-conn-pinned' }));

    expect(res.status).toBe(200);
    const [options] = coreMocks.handleChatCore.mock.calls[0];
    // Exact equality, not a substring/prefix check: a mutated implementation
    // that swapped in a sibling model (e.g. a cheaper default) still contains
    // "codex/" and would pass a looser assertion.
    expect(options.body.model).toBe('codex/gpt-5.6-sol');
    expect(options.modelInfo.model).toBe('gpt-5.6-sol');
  });

  it('fails the request rather than retrying on another connection when the pinned one is quota-exhausted (mutation: retry quota failure on another connection)', async () => {
    authMocks.getProviderCredentials.mockResolvedValue({
      allRateLimited: true,
      lastError: 'quota exhausted',
      lastErrorCode: 429,
      retryAfter: null,
      retryAfterHuman: 'later',
    });

    const res = await POST(responsesRequest('codex/gpt-5.6-sol', { 'x-connection-id': 'codex-conn-pinned' }));

    expect(res.status).toBe(429);
    expect(coreMocks.handleChatCore).not.toHaveBeenCalled();
    // The load-bearing part of this mutation: selection ran exactly once. A
    // retry-on-another-connection implementation would call this a second
    // time, excluding the pinned connection, before giving up.
    expect(authMocks.getProviderCredentials).toHaveBeenCalledTimes(1);
  });
});
