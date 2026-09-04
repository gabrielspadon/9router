/**
 * #1412 — a non-streaming turn that returns BOTH visible content and
 * tool_calls must keep `reasoning_content`.
 *
 * The post-translation strip in nonStreamingHandler dropped
 * `reasoning_content` whenever `content` was non-empty, with no exemption for
 * tool calls. Clients that replay reasoning alongside a tool call (the
 * thinking block belongs to the decision to call the tool) lost it.
 *
 * Plain visible-content responses must still be stripped exactly as before —
 * that strip exists to stop scratch reasoning from being echoed back as input
 * tokens on the next turn.
 *
 * Only the response half of the upstream PR is ported here. The request-side
 * replay is already covered, and more strictly, by
 * tests/unit/tool-call-reasoning-content-1480.test.js.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/usageDb.js', () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));
vi.mock('../../open-sse/handlers/chatCore/requestDetail.js', () => ({
  buildRequestDetail: vi.fn((detail) => detail),
  extractRequestConfig: vi.fn(() => ({})),
  extractUsageFromResponse: vi.fn((response) => response?.usage || {}),
  saveUsageStats: vi.fn(),
  formatDoneLine: vi.fn(() => 'done'),
  doneFields: vi.fn(() => ({ t: 1, in: 9, out: 5, cr: 0, cw: 0, ttft: 1 })),
}));

const { FORMATS } = await import('../../open-sse/translator/formats.js');
const { handleNonStreamingResponse } =
  await import('../../open-sse/handlers/chatCore/nonStreamingHandler.js');

const REASONING = 'the user asked for the weather, so I should call get_weather';

function completion({ toolCalls = false } = {}) {
  const message = {
    role: 'assistant',
    content: 'Let me look that up for you.',
    reasoning_content: REASONING,
  };
  if (toolCalls) {
    message.tool_calls = [
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"city":"Halifax"}' },
      },
    ];
  }
  return {
    id: 'chatcmpl-1412',
    object: 'chat.completion',
    created: 1700000000,
    model: 'thinker-1',
    choices: [{ index: 0, message, finish_reason: toolCalls ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 9, completion_tokens: 5, total_tokens: 14 },
  };
}

async function runNonStreaming(upstreamBody) {
  const result = await handleNonStreamingResponse({
    providerResponse: new Response(JSON.stringify(upstreamBody), {
      headers: { 'content-type': 'application/json' },
    }),
    provider: 'openai',
    model: 'thinker-1',
    sourceFormat: FORMATS.OPENAI,
    targetFormat: FORMATS.OPENAI,
    body: { model: 'thinker-1', stream: false },
    stream: false,
    translatedBody: {},
    finalBody: {},
    requestStartTime: Date.now(),
    connectionId: 'conn-1412',
    apiKey: 'test-key',
    clientRawRequest: { endpoint: '/v1/chat/completions', body: { model: 'thinker-1' } },
    reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
    toolNameMap: null,
    customToolNames: null,
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    pxpipe: null,
    reqTag: 'TEST',
    log: { line: vi.fn(), warn: vi.fn() },
  });
  expect(result.success).toBe(true);
  return await result.response.json();
}

describe('#1412 non-streaming reasoning_content alongside tool_calls', () => {
  it('keeps reasoning_content when the choice carries tool_calls', async () => {
    const out = await runNonStreaming(completion({ toolCalls: true }));
    const message = out.choices[0].message;
    expect(message.reasoning_content).toBe(REASONING);
    expect(message.content).toBe('Let me look that up for you.');
    expect(message.tool_calls[0].function.name).toBe('get_weather');
  });

  it('still strips reasoning_content on a plain visible-content response', async () => {
    const out = await runNonStreaming(completion());
    const message = out.choices[0].message;
    expect(message.reasoning_content).toBeUndefined();
    expect(message.content).toBe('Let me look that up for you.');
  });
});
