import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "../../open-sse/config/errorConfig.js";
import { parseUpstreamError } from "../../open-sse/utils/error.js";

const NOW = new Date("2026-08-31T16:00:00.000Z");

function rateLimitResponse(error, headers = {}) {
  return new Response(JSON.stringify({ error: { message: "quota exhausted", ...error } }), {
    status: 429,
    headers,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => vi.useRealTimers());

describe("parseUpstreamError reset metadata (#879)", () => {
  it("accepts only a future RFC3339 error.retryAfter timestamp", async () => {
    const reset = "2026-08-31T16:05:00.000Z";

    const parsed = await parseUpstreamError(rateLimitResponse({ retryAfter: reset }));

    expect(parsed.resetsAtMs).toBe(Date.parse(reset));
  });

  it("does not promote a top-level retryAfter field into account state", async () => {
    const parsed = await parseUpstreamError(new Response(JSON.stringify({
      error: { message: "quota exhausted" },
      retryAfter: "2026-08-31T16:05:00.000Z",
    }), { status: 429 }));

    expect(parsed.resetsAtMs).toBeUndefined();
  });

  it.each([
    ["malformed absolute timestamp", { retryAfter: "2026-08-31 16:05:00" }],
    ["past absolute timestamp", { retryAfter: "2026-08-31T15:59:59Z" }],
    ["zero snake-case relative delay", { retry_after_ms: 0 }],
    ["zero camel-case relative delay", { retryAfterMs: 0 }],
    ["string relative delay", { retry_after_ms: "5000" }],
  ])("rejects %s", async (_label, error) => {
    const parsed = await parseUpstreamError(rateLimitResponse(error));

    expect(parsed.resetsAtMs).toBeUndefined();
  });

  it("rejects a calendar-invalid RFC3339 timestamp before Date.parse can normalize it", async () => {
    vi.setSystemTime(new Date("2026-02-01T16:00:00.000Z"));

    const parsed = await parseUpstreamError(
      rateLimitResponse({ retryAfter: "2026-02-30T16:05:00Z" }),
    );

    expect(parsed.resetsAtMs).toBeUndefined();
  });

  it.each([
    ["retry_after_ms", { retry_after_ms: 5_000 }],
    ["retryAfterMs", { retryAfterMs: 8_000 }],
  ])("derives a reset from positive finite %s", async (_field, error) => {
    const parsed = await parseUpstreamError(rateLimitResponse(error));

    expect(parsed.resetsAtMs).toBe(NOW.getTime() + Object.values(error)[0]);
  });

  it("caps a representable but enormous relative delay before downstream date serialization", async () => {
    const parsed = await parseUpstreamError(new Response(
      '{"error":{"message":"quota exhausted","retryAfterMs":1.7976931348623157e308}}',
      { status: 429 },
    ));

    expect(parsed.resetsAtMs).toBe(NOW.getTime() + MAX_RATE_LIMIT_COOLDOWN_MS);
    expect(Number.isFinite(new Date(parsed.resetsAtMs).getTime())).toBe(true);
  });

  it("keeps the existing Retry-After header ahead of body reset metadata", async () => {
    const parsed = await parseUpstreamError(
      rateLimitResponse(
        { retryAfter: "2026-08-31T16:05:00.000Z", retry_after_ms: 60_000 },
        { "Retry-After": "15" },
      ),
    );

    expect(parsed.resetsAtMs).toBe(NOW.getTime() + 15_000);
  });

  it("keeps the existing text retry fallback when body metadata is invalid", async () => {
    const parsed = await parseUpstreamError(
      rateLimitResponse({ message: "retry in 5 seconds", retryAfter: "not-a-timestamp" }),
    );

    expect(parsed.resetsAtMs).toBe(NOW.getTime() + 5_000);
  });

  it("propagates body reset metadata through DefaultExecutor without an executor override", async () => {
    const parsed = await parseUpstreamError(
      rateLimitResponse({ retryAfterMs: 3_000 }),
      new DefaultExecutor("minimax"),
    );

    expect(parsed).toMatchObject({
      statusCode: 429,
      message: "quota exhausted",
      resetsAtMs: NOW.getTime() + 3_000,
    });
  });
});
