import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Verifies upstream PR 2129: reasoning_content is stripped from assistant
// history and the trailing assistant message is marked prefix=true before
// dispatch (Mistral rejects both otherwise).

const dispatchMocks = vi.hoisted(() => ({ handleChatCore: vi.fn() }));
const modelMocks = vi.hoisted(() => ({ getComboModels: vi.fn(), getModelInfo: vi.fn() }));
const settingsMocks = vi.hoisted(() => ({ getSettings: vi.fn() }));
const logMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  maskKey: vi.fn(() => '***'),
  warn: vi.fn(),
}));

vi.mock('@/sse/services/auth.js', () => ({
  clearAccountError: vi.fn(),
  extractApiKey: () => null,
  getProviderCredentials: vi.fn(async () => ({
    connectionId: 'account-a',
    connectionName: 'account-a',
    providerSpecificData: {},
  })),
  isValidApiKey: vi.fn(async () => true),
  markAccountUnavailable: vi.fn(),
}));
vi.mock('open-sse/handlers/chatCore.js', () => dispatchMocks);
vi.mock('open-sse/services/combo.js', () => ({
  detectRequiredCapabilities: vi.fn(() => []),
  handleComboChat: vi.fn(),
  handleFusionChat: vi.fn(),
}));
vi.mock('@/sse/services/model.js', () => modelMocks);
vi.mock('@/lib/localDb', () => settingsMocks);
vi.mock('@/sse/services/tokenRefresh.js', () => ({
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  updateProviderCredentials: vi.fn(),
}));
vi.mock('@/sse/utils/logger.js', () => logMocks);
vi.mock('open-sse/utils/requestLogger.js', () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

let handleChat;

function request(body) {
  return new Request('http://localhost/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  ({ handleChat } = await import('../../src/sse/handlers/chat.js'));
});

beforeEach(() => {
  vi.clearAllMocks();
  settingsMocks.getSettings.mockResolvedValue({
    requireApiKey: false,
    providerThinking: {},
    cavemanEnabled: false,
    ponytailEnabled: false,
    ccFilterNaming: false,
  });
  modelMocks.getComboModels.mockResolvedValue(null);
  modelMocks.getModelInfo.mockResolvedValue({ provider: 'mistral', model: 'mistral-large' });
  dispatchMocks.handleChatCore.mockResolvedValue({
    success: true,
    response: Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
  });
});

describe('mistral message normalization (PR 2129)', () => {
  it('strips reasoning_content from assistant history and sets prefix on trailing assistant', async () => {
    const body = {
      model: 'mistral/mistral-large',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'partial answer', reasoning_content: 'chain of thought' },
      ],
    };
    const response = await handleChat(request(body));
    expect(response.status).toBe(200);

    const dispatched = dispatchMocks.handleChatCore.mock.calls[0][0].body;
    expect(dispatched.messages[0]).toEqual({ role: 'user', content: 'hi' });
    expect(dispatched.messages[1]).toEqual({
      role: 'assistant',
      content: 'partial answer',
      prefix: true,
    });
    expect(dispatched.messages[1].reasoning_content).toBeUndefined();
  });

  it('leaves bodies without assistant reasoning or trailing assistant untouched', async () => {
    const body = {
      model: 'mistral/mistral-large',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
    };
    await handleChat(request(body));
    expect(dispatchMocks.handleChatCore.mock.calls[0][0].body.messages).toEqual(body.messages);
  });
});
