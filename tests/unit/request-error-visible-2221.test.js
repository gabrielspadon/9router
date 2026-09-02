// #2221 (second half) — "add a function that allows viewing specific logs when
// a click error occurs". Today a failed request leaves the operator nothing:
//
//   • open-sse/handlers/chatCore/requestDetail.js saveUsageStats() returns early
//     when in+out tokens are 0, so a failure writes NO usageHistory row — and
//     /api/usage/logs and /api/usage/request-logs are derived from that table.
//   • src/lib/db/repos/usageRepo.js appendRequestLog() is an empty function, so
//     the `FAILED <status>` line chatCore hands it is dropped on the floor.
//   • requestStats records the failure but has no column for the reason.
//   • requestDetails DOES store the upstream body verbatim as
//     response: { error, status } (chatCore.js:855 transport, :1176 HTTP) — and
//     /api/usage/request-details blanked it to { redacted: true } along with the
//     conversation payloads, so the one surviving copy was unreachable.
//
// The route now keeps the error envelope and nothing else. Conversation content
// stays redacted.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getRequestDetails = vi.fn();
const isObservabilityEnabled = vi.fn();

vi.mock('@/lib/usageDb', () => ({ getRequestDetails: (...a) => getRequestDetails(...a) }));
vi.mock('@/lib/requestDetailsDb', () => ({
  isObservabilityEnabled: (...a) => isObservabilityEnabled(...a),
}));

const { GET, redactDetail } = await import('@/app/api/usage/request-details/route.js');

const call = () =>
  GET(new Request('http://localhost/api/usage/request-details')).then((r) => r.json());

const page = (details) => ({
  details,
  pagination: {
    page: 1,
    pageSize: 20,
    totalItems: details.length,
    totalPages: 1,
    hasNext: false,
    hasPrev: false,
  },
});

// Exactly what chatCore's HTTP-failure path stores (verified against rows in a
// live requestDetails table: a 404 model miss and a 429 rate limit).
const failedRow = {
  id: 'err-1',
  provider: 'claude',
  model: 'claude-haiku-4.5',
  status: 'error',
  latency: { ttft: 0, total: 812 },
  tokens: { prompt_tokens: 0, completion_tokens: 0 },
  request: { messages: [{ role: 'user', content: 'private prompt' }] },
  providerRequest: { messages: [{ role: 'user', content: 'private prompt' }] },
  response: {
    error:
      '{"type":"error","error":{"type":"not_found_error","message":"model: claude-haiku-4.5"}}',
    status: 404,
    thinking: null,
  },
};

beforeEach(() => {
  getRequestDetails.mockReset().mockResolvedValue(page([]));
  isObservabilityEnabled.mockReset().mockResolvedValue(true);
});

describe('a failed request keeps a readable reason (#2221)', () => {
  it('serves the upstream error text and status for a failed request', async () => {
    getRequestDetails.mockResolvedValue(page([failedRow]));
    const [d] = (await call()).details;
    expect(d.response.error).toContain('not_found_error');
    expect(d.response.error).toContain('model: claude-haiku-4.5');
    expect(d.response.status).toBe(404);
    // Metadata the tab already showed is untouched.
    expect(d.status).toBe('error');
    expect(d.provider).toBe('claude');
    expect(d.latency).toEqual({ ttft: 0, total: 812 });
  });

  it('still redacts request bodies on that same failed row', async () => {
    getRequestDetails.mockResolvedValue(page([failedRow]));
    const [d] = (await call()).details;
    expect(d.request).toEqual({ redacted: true });
    expect(d.providerRequest).toEqual({ redacted: true });
    expect(JSON.stringify(d)).not.toContain('private prompt');
    // Fields of the response other than the envelope do not survive either.
    expect(d.response).not.toHaveProperty('thinking');
    expect(d.response.redacted).toBe(true);
  });

  it('redacts a successful response completely — no leak through the new branch', async () => {
    getRequestDetails.mockResolvedValue(
      page([
        {
          id: 'ok-1',
          status: 'success',
          request: { messages: [{ role: 'user', content: 'secret prompt' }] },
          providerResponse: { choices: [{ message: { content: 'secret answer' } }] },
          response: { content: 'secret answer', thinking: 'secret reasoning' },
        },
      ])
    );
    const [d] = (await call()).details;
    expect(d.response).toEqual({ redacted: true });
    expect(d.providerResponse).toEqual({ redacted: true });
    expect(JSON.stringify(d)).not.toContain('secret');
  });

  it('caps error text so a provider echoing the request back cannot dump it', () => {
    const long = 'x'.repeat(5000);
    const out = redactDetail({ response: { error: long, status: 400 } });
    expect(out.response.error.length).toBeLessThanOrEqual(2001);
    expect(out.response.error.endsWith('…')).toBe(true);
  });

  it('handles a non-string error object and a missing status', () => {
    const out = redactDetail({ response: { error: { type: 'overloaded_error' } } });
    expect(out.response.error).toBe('{"type":"overloaded_error"}');
    expect(out.response.status).toBe(null);
  });

  it('treats a null error as no error at all', () => {
    const out = redactDetail({ response: { error: null, content: 'answer' } });
    expect(out.response).toEqual({ redacted: true });
  });
});
