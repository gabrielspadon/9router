import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// boundary-contract.json: client.completion.entry — owner "completion request
// handler", live_gate "selected lane reaches only its registered model".
// Exercised at POST /v1/chat/completions (src/app/api/v1/chat/completions/route.js),
// which is a bare passthrough to @/sse/handlers/chat.js#handleChat — calling
// the exported POST is calling the real public entry point, not an internal.
// handleChatCore (open-sse) is the one seam mocked deep enough to observe
// what the handler actually dispatches, the same proven harness shape as
// tests/unit/connection-default-model-474.test.js for this exact handler.
//
// Mutations this file must fail under if reintroduced:
//   - "accept unknown model": a model with no resolvable provider is
//     dispatched anyway instead of refused before any upstream call.
//   - "ignore managed client identity": a caller's x-connection-id pin is
//     silently substituted for a different, healthy connection instead of
//     refused.

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
// Spread the real module: a partial mock fails the WHOLE file the moment the
// module gains an export this object does not name.
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

function selectedCredentials(overrides = {}) {
  return {
    connectionId: 'conn-a',
    connectionName: 'Anthropic A',
    apiKey: 'provider-secret',
    providerSpecificData: {},
    defaultModel: 'claude-opus-4-1',
    ...overrides,
  };
}

function chatRequest(model, headers = {}) {
  return new Request('http://localhost/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hello' }] }),
  });
}

function success() {
  return { success: true, response: Response.json({ id: 'chatcmpl-1', choices: [] }) };
}

beforeAll(async () => {
  ({ POST } = await import('@/app/api/v1/chat/completions/route.js'));
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
  modelMocks.getModelInfo.mockResolvedValue({ provider: 'anthropic', model: 'claude-opus-4-1' });
  authMocks.getProviderCredentials.mockResolvedValue(selectedCredentials());
  authMocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false });
  coreMocks.handleChatCore.mockResolvedValue(success());
});

describe('client.completion.entry — selected lane reaches only its registered model', () => {
  it('dispatches the exact requested model to the exact selected connection, nothing substituted', async () => {
    const res = await POST(chatRequest('anthropic/claude-opus-4-1'));

    expect(res.status).toBe(200);
    expect(coreMocks.handleChatCore).toHaveBeenCalledTimes(1);
    const [options] = coreMocks.handleChatCore.mock.calls[0];
    expect(options.modelInfo).toEqual({ provider: 'anthropic', model: 'claude-opus-4-1' });
    expect(options.body.model).toBe('anthropic/claude-opus-4-1');
    expect(options.connectionId).toBe('conn-a');
  });

  it('refuses a model with no resolvable provider rather than dispatching it (mutation: accept unknown model)', async () => {
    modelMocks.getModelInfo.mockResolvedValue({ provider: null, model: null });

    const res = await POST(chatRequest('totally-unregistered-model-xyz'));

    expect(res.status).toBe(400);
    expect(coreMocks.handleChatCore).not.toHaveBeenCalled();
  });

  it('refuses to substitute a healthy connection for the one the client pinned (mutation: ignore managed client identity)', async () => {
    authMocks.getProviderCredentials.mockResolvedValue(selectedCredentials({ connectionId: 'conn-OTHER' }));

    const res = await POST(chatRequest('anthropic/claude-opus-4-1', { 'x-connection-id': 'conn-PINNED' }));

    expect(res.status).toBe(503);
    expect(coreMocks.handleChatCore).not.toHaveBeenCalled();
  });

  it('honors an exact pin match and reaches only that connection', async () => {
    authMocks.getProviderCredentials.mockResolvedValue(selectedCredentials({ connectionId: 'conn-PINNED' }));

    const res = await POST(chatRequest('anthropic/claude-opus-4-1', { 'x-connection-id': 'conn-PINNED' }));

    expect(res.status).toBe(200);
    const [options] = coreMocks.handleChatCore.mock.calls[0];
    expect(options.connectionId).toBe('conn-PINNED');
  });
});
