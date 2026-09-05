// HEADROOM RUNS ONLY UNDER CONTEXT PRESSURE.
//
// compressWithHeadroom's apply/skip outcome turns on volatile content (payload
// size, an error tool result being present, whether the proxy finds >5% to
// cut), so running it on every request made the outcome oscillate WITHIN one
// conversation, and each flip rewrote the prompt prefix the provider had
// cached. Measured on the RTX seam over 422 requests: a turn whose outcome
// flipped shared a mean 62,568 bytes of prefix with the previous turn (49%
// under 2 KB) against 152,892 bytes (17% under 2 KB) when the outcome held.
//
// chatCore.js therefore gates the call on measureContextPressure().over, the
// same discipline services/memory/index.js already applies. These tests drive
// the real handler and assert on whether the proxy was reached at all.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock('../../open-sse/executors/index.js', () => ({
  getExecutor: () => ({ noAuth: true, execute: executeMock }),
}));

vi.mock('../../open-sse/utils/requestLogger.js', () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock('../../open-sse/utils/stream.js', () => ({
  COLORS: { red: '', reset: '' },
  createPassthroughStreamWithLogger: vi.fn(() => new TransformStream()),
}));

vi.mock('@/lib/usageDb.js', () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import('../../open-sse/handlers/chatCore.js');
const { measureContextPressure } = await import('../../open-sse/services/memory/contextBudget.js');

// A tiny window makes "over budget" reachable without building a megabyte of
// fixture. The override is a real operator setting (memoryContextWindowOverride),
// so this exercises the shipped resolution path rather than a test-only seam.
const TINY_WINDOW = { memoryContextWindowOverride: 20_000 };

const TEST_AUTH = { apiKey: 'test-key', providerSpecificData: {} };

function conversation(padChars) {
  return {
    model: 'gpt-4o',
    stream: false,
    messages: [{ role: 'user', content: 'x'.repeat(padChars) }],
  };
}

async function run(body, extra = {}) {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
  await handleChatCore({
    body,
    modelInfo: { provider: 'openai', model: 'gpt-4o' },
    credentials: TEST_AUTH,
    log,
    connectionId: 'test-conn',
    headroomEnabled: true,
    headroomUrl: 'http://localhost:8787',
    headroomCompressUserMessages: false,
    rtkEnabled: false,
    cavemanEnabled: false,
    ponytailEnabled: false,
    clientRawRequest: {
      endpoint: '/v1/chat/completions',
      body: {},
      headers: { accept: 'application/json' },
    },
    ...extra,
  });
  return log;
}

let compressCalls;

beforeEach(() => {
  vi.clearAllMocks();
  compressCalls = 0;
  global.fetch = vi.fn(async (url) => {
    if (String(url).includes('/v1/compress')) {
      compressCalls += 1;
      // Fail-open: what the proxy answers is irrelevant here, only whether it
      // was asked at all.
      throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8787'), {
        code: 'ECONNREFUSED',
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  executeMock.mockResolvedValue({
    response: new Response(
      JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        choices: [
          { message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop', index: 0 },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    ),
    url: 'https://api.openai.com/v1/chat/completions',
    headers: {},
    transformedBody: null,
  });
});

describe('Headroom is gated on context pressure', () => {
  it('does not call the proxy for a request inside the budget', async () => {
    const body = conversation(200);
    // Guard the fixture itself: a test that silently stopped being under
    // budget would pass for the wrong reason.
    expect(measureContextPressure(body, { settings: TINY_WINDOW }).over).toBe(false);

    const log = await run(body, { memorySettings: TINY_WINDOW });

    expect(compressCalls).toBe(0);
    expect(log.warn).toHaveBeenCalledWith(
      'HEADROOM',
      expect.stringContaining('within context budget')
    );
  });

  it('calls the proxy once the request is over the budget', async () => {
    // 20k window, 5% reserve floored at 8k tokens => budget is half the window,
    // 10k tokens, ~38k chars at CHARS_PER_TOKEN 3.8.
    const body = conversation(120_000);
    expect(measureContextPressure(body, { settings: TINY_WINDOW }).over).toBe(true);

    await run(body, { memorySettings: TINY_WINDOW });

    expect(compressCalls).toBe(1);
  });

  it('reports the budget skip distinctly from the toggle being off', async () => {
    // #1956: the operator has to be able to tell "Headroom is off" from
    // "Headroom is on and declined to touch this request".
    const inBudget = await run(conversation(200), { memorySettings: TINY_WINDOW });
    const offEntirely = await run(conversation(200), {
      memorySettings: TINY_WINDOW,
      headroomEnabled: false,
    });

    const said = (log) => JSON.stringify(log.warn.mock.calls);
    expect(said(inBudget)).toContain('within context budget');
    expect(said(inBudget)).not.toContain('disabled in settings');
    expect(said(offEntirely)).toContain('disabled in settings');
  });

  it('keeps the prefix byte-identical across turns that stay inside the budget', async () => {
    // The defect this gate fixes, stated as behaviour: two consecutive turns of
    // a growing conversation must leave the earlier turn's bytes untouched, so
    // the provider's cached prefix survives.
    const first = conversation(200);
    const firstSerialized = JSON.stringify(first.messages[0]);
    await run(first, { memorySettings: TINY_WINDOW });
    expect(JSON.stringify(first.messages[0])).toBe(firstSerialized);

    const second = {
      ...conversation(200),
      messages: [
        { role: 'user', content: 'x'.repeat(200) },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'next' },
      ],
    };
    await run(second, { memorySettings: TINY_WINDOW });
    expect(JSON.stringify(second.messages[0])).toBe(firstSerialized);
    expect(compressCalls).toBe(0);
  });
});
