/**
 * PR #1821 — OpenAI's token endpoint answers a dead Codex refresh token with
 * HTTP 401 {error:{code:"token_expired"}}. None of the existing permanent
 * markers match it, so the classifier called it transient and refreshWithRetry
 * burned three attempts (and ~3s of caller latency) on a credential that can
 * only be fixed by re-authenticating.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const originalFetch = global.fetch;

describe("Codex token_expired refresh classification (#1821)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    global.fetch = originalFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("classifies a 401 token_expired body as permanent", async () => {
    const { classifyOAuthRefreshError } = await import("../../open-sse/services/tokenRefresh.js");
    const failure = classifyOAuthRefreshError(
      JSON.stringify({ error: { code: "token_expired", type: "invalid_request_error" } }),
      401,
    );
    expect(failure.code).toBe("token_expired");
    expect(failure.permanent).toBe(true);
  });

  it("keeps a rate-limit body transient", async () => {
    const { classifyOAuthRefreshError } = await import("../../open-sse/services/tokenRefresh.js");
    const failure = classifyOAuthRefreshError(
      JSON.stringify({ error: { code: "rate_limit_exceeded", message: "slow down" } }),
      429,
    );
    expect(failure.permanent).toBe(false);
  });

  it("returns an unrecoverable result instead of null so the retry loop stops", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve(JSON.stringify({ error: { code: "token_expired" } })),
    });

    const { refreshCodexToken, isUnrecoverableRefreshError, refreshWithRetry } = await import(
      "../../open-sse/services/tokenRefresh.js"
    );

    const result = await refreshCodexToken("dead-refresh-token-1821", null);
    expect(result).toEqual({ error: "unrecoverable_refresh_error", code: "token_expired" });
    expect(isUnrecoverableRefreshError(result)).toBe(true);

    // refreshWithRetry stops on the first truthy result: one upstream call, no backoff.
    global.fetch.mockClear();
    const retried = await refreshWithRetry(() => refreshCodexToken("dead-refresh-token-1821-b", null), 3, null);
    expect(isUnrecoverableRefreshError(retried)).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
