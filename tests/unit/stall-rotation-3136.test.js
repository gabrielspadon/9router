// #3136 — a stream that stalls in the reasoning phase must take the account out
// of rotation for the next request, the same way an empty stream already does.
// Before this, a stall only wrote a "cancelled" request-detail row and the next
// request was routed straight back to the account that had gone silent.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveRequestDetail: vi.fn(),
  saveRequestUsage: vi.fn(),
  appendRequestLog: vi.fn(),
  trackPendingRequest: vi.fn(),
}));

vi.mock('@/lib/usageDb.js', () => ({
  saveRequestDetail: mocks.saveRequestDetail,
  saveRequestUsage: mocks.saveRequestUsage,
  appendRequestLog: mocks.appendRequestLog,
  trackPendingRequest: mocks.trackPendingRequest,
}));

const { buildOnStreamComplete } =
  await import('../../open-sse/handlers/chatCore/streamingHandler.js');

const baseCtx = {
  provider: 'testprov',
  model: 'test-model',
  connectionId: 'conn-12345678',
  apiKey: 'client-key',
  requestStartTime: Date.now() - 1000,
  body: { messages: [{ role: 'user', content: 'hi' }] },
  stream: true,
  finalBody: null,
  translatedBody: null,
  clientRawRequest: { endpoint: '/v1/chat/completions' },
  pxpipe: undefined,
  reqTag: 'T1',
  log: null,
};

function build(onEmptyStream) {
  return buildOnStreamComplete({ ...baseCtx, onEmptyStream });
}

describe('stall timeout takes the account out of rotation (#3136)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveRequestDetail.mockResolvedValue(undefined);
    mocks.saveRequestUsage.mockResolvedValue(undefined);
  });

  it('locks the account when the stream stalls before producing an answer', () => {
    const onEmptyStream = vi.fn();
    const { onStreamAbandoned } = build(onEmptyStream);

    onStreamAbandoned('stall_timeout');

    expect(onEmptyStream).toHaveBeenCalledTimes(1);
  });

  it('locks the account when the stall happens mid-reasoning', () => {
    const onEmptyStream = vi.fn();
    const { onStreamAbandoned, streamState } = build(onEmptyStream);
    // Reasoning tokens arrived, the final answer never started — the exact
    // case the report describes.
    streamState.thinking = 'let me think about this';

    onStreamAbandoned('stall_timeout');

    expect(onEmptyStream).toHaveBeenCalledTimes(1);
  });

  it('does not lock when the stall interrupts a healthy final response', () => {
    const onEmptyStream = vi.fn();
    const { onStreamAbandoned, streamState } = build(onEmptyStream);
    streamState.content = 'here is the answer so far';

    onStreamAbandoned('stall_timeout');

    expect(onEmptyStream).not.toHaveBeenCalled();
  });

  it('does not lock when the provider already reported output tokens', () => {
    const onEmptyStream = vi.fn();
    const { onStreamAbandoned, streamState } = build(onEmptyStream);
    streamState.usage = { prompt_tokens: 10, completion_tokens: 7 };

    onStreamAbandoned('stall_timeout');

    expect(onEmptyStream).not.toHaveBeenCalled();
  });

  it('does not lock the account when the client disconnects', () => {
    const onEmptyStream = vi.fn();
    const { onStreamAbandoned } = build(onEmptyStream);

    onStreamAbandoned('client_disconnected');

    expect(onEmptyStream).not.toHaveBeenCalled();
  });

  it('does not lock the account on a generic stream error', () => {
    const onEmptyStream = vi.fn();
    const { onStreamAbandoned } = build(onEmptyStream);

    onStreamAbandoned('stream_error');

    expect(onEmptyStream).not.toHaveBeenCalled();
  });

  it('locks at most once when abandon fires twice', () => {
    const onEmptyStream = vi.fn();
    const { onStreamAbandoned } = build(onEmptyStream);

    onStreamAbandoned('stall_timeout');
    onStreamAbandoned('stall_timeout');

    expect(onEmptyStream).toHaveBeenCalledTimes(1);
  });

  it('survives an onEmptyStream that rejects', async () => {
    const onEmptyStream = vi.fn(async () => {
      throw new Error('db down');
    });
    const { onStreamAbandoned } = build(onEmptyStream);

    expect(() => onStreamAbandoned('stall_timeout')).not.toThrow();
    await Promise.resolve();
    expect(onEmptyStream).toHaveBeenCalledTimes(1);
  });

  it('still locks on an empty completed stream (unchanged path)', () => {
    const onEmptyStream = vi.fn();
    const { onStreamComplete } = build(onEmptyStream);

    onStreamComplete({ content: '', thinking: '' }, null, Date.now());

    expect(onEmptyStream).toHaveBeenCalledTimes(1);
  });

  it('still does not lock on a completed stream that produced content', () => {
    const onEmptyStream = vi.fn();
    const { onStreamComplete } = build(onEmptyStream);

    onStreamComplete(
      { content: 'a real answer', thinking: '' },
      { prompt_tokens: 5, completion_tokens: 3 },
      Date.now()
    );

    expect(onEmptyStream).not.toHaveBeenCalled();
  });
});
