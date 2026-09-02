import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  anchorClaudeCache: vi.fn(),
}));

vi.mock('../../open-sse/executors/index.js', () => ({
  getExecutor: vi.fn(() => ({ execute: mocks.execute, noAuth: false })),
}));
vi.mock('../../open-sse/translator/index.js', () => ({
  translateRequest: vi.fn((_source, _target, model, body) => ({ ...body, model })),
}));
vi.mock('../../open-sse/utils/requestLogger.js', () => ({
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logError: vi.fn(),
  })),
}));
// No CLI tool identity and no native pair: this is the TRANSLATED path, the one
// the anchor used to skip.
vi.mock('../../open-sse/utils/clientDetector.js', () => ({
  detectClientTool: vi.fn(() => null),
  isNativePassthrough: vi.fn(() => false),
}));
vi.mock('../../open-sse/utils/bypassHandler.js', () => ({
  handleBypassRequest: vi.fn(() => null),
}));
vi.mock('../../open-sse/utils/proxyFetch.js', () => ({
  default: vi.fn(),
  proxyAwareFetch: vi.fn(),
}));
vi.mock('../../open-sse/translator/formats/claude.js', () => ({
  normalizeClaudePassthrough: vi.fn(),
  anchorClaudeCache: mocks.anchorClaudeCache,
}));
vi.mock('../../open-sse/utils/toolDeduper.js', () => ({
  dedupeTools: vi.fn((tools) => ({ tools, stripped: [] })),
}));
vi.mock('../../open-sse/rtk/caveman.js', () => ({ injectCaveman: vi.fn() }));
vi.mock('../../open-sse/rtk/ponytail.js', () => ({ injectPonytail: vi.fn() }));
vi.mock('../../open-sse/rtk/index.js', () => ({
  compressMessages: vi.fn(() => null),
  formatRtkLog: vi.fn(() => ''),
}));
vi.mock('../../open-sse/rtk/headroom.js', () => ({
  compressWithHeadroom: vi.fn(async () => null),
  formatHeadroomLog: vi.fn(() => ''),
  formatHeadroomSizeLog: vi.fn(() => ''),
  isHeadroomPhantomSavings: vi.fn(() => false),
}));
vi.mock('../../open-sse/providers/capabilities.js', () => ({
  getCapabilitiesForModel: vi.fn(() => ({})),
}));
vi.mock('../../open-sse/translator/concerns/modality.js', () => ({
  stripUnsupportedModalities: vi.fn(() => false),
}));
vi.mock('../../open-sse/translator/concerns/prefetch.js', () => ({
  prefetchRemoteImages: vi.fn(async () => 0),
}));
vi.mock('../../open-sse/translator/concerns/adaptiveStripper.js', () => ({
  stripRejectedFields: vi.fn(() => null),
  addRejectedFields: vi.fn(),
  getRejectedFields: vi.fn(() => new Set()),
  extractRejectedFieldNamesFromError: vi.fn(() => []),
}));
vi.mock('../../open-sse/handlers/chatCore/requestDetail.js', () => ({
  buildRequestDetail: vi.fn((detail) => detail),
  extractRequestConfig: vi.fn(() => ({})),
}));
vi.mock('../../open-sse/handlers/chatCore/nonStreamingHandler.js', () => ({
  handleNonStreamingResponse: vi.fn(async ({ providerResponse }) => ({
    success: true,
    response: providerResponse,
  })),
}));
vi.mock('../../open-sse/handlers/chatCore/sseToJsonHandler.js', () => ({
  handleForcedSSEToJson: vi.fn(async () => null),
}));
vi.mock('../../open-sse/handlers/chatCore/streamingHandler.js', () => ({
  buildOnStreamComplete: vi.fn(() => ({
    onStreamComplete: vi.fn(),
    onStreamAbandoned: vi.fn(),
    streamDetailId: null,
    streamState: {},
  })),
  handleStreamingResponse: vi.fn(() => ({ success: true, response: new Response() })),
}));
vi.mock('@/lib/usageDb.js', () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));

const { handleChatCore } = await import('../../open-sse/handlers/chatCore.js');

function options(provider, model) {
  const body = { model, messages: [{ role: 'user', content: 'hello' }], stream: false };
  return {
    body,
    modelInfo: { provider, model },
    credentials: { apiKey: 'test', providerSpecificData: {} },
    clientRawRequest: {
      endpoint: '/v1/chat/completions',
      body,
      headers: { accept: 'application/json' },
    },
    connectionId: 'connection-1',
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockResolvedValue({
    response: new Response(null, { status: 200 }),
    url: 'https://upstream.test/messages',
    headers: {},
    transformedBody: {},
  });
});

// #2808: the cache anchor is the LAST step that can repair a breakpoint the token
// savers moved, and it was gated on native Claude-CLI passthrough. Every other
// client reaching a Claude-format upstream kept the anchor prepareClaudeRequest
// stamped BEFORE tool/media pruning and compaction reshaped the body, so the
// cached prefix no longer matched and the whole prompt was billed uncached.
describe('claude cache anchor on the translated path (#2808)', () => {
  it('re-anchors when the final body is Claude format but the client is not the Claude CLI', async () => {
    await handleChatCore(options('claude', 'claude-sonnet-4.6'));

    expect(mocks.anchorClaudeCache).toHaveBeenCalledTimes(1);
    expect(mocks.anchorClaudeCache).toHaveBeenCalledWith(
      expect.objectContaining({ messages: expect.any(Array) })
    );
  });

  it('leaves a non-Claude upstream alone', async () => {
    await handleChatCore(options('deepseek', 'deepseek-chat'));

    expect(mocks.anchorClaudeCache).not.toHaveBeenCalled();
  });
});
