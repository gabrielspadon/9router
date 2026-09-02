import { describe, expect, it } from "vitest";
import {
  applyErrorState,
  checkFallbackError,
  filterAvailableAccounts,
  getEarliestRateLimitedUntil,
  getQuotaCooldown,
  isAccountUnavailable,
  resetAccountState,
} from "open-sse/services/accountFallback.js";
import { BACKOFF_CONFIG } from "open-sse/config/errorConfig.js";

// #2429 asks for intra-provider key fallback: several keys for one provider,
// rotate on a key-level failure, cool the failed key down, and only leave the
// provider once every key is out. Each of those steps already exists — a "key"
// is a connection row, and one provider holds as many as the user adds. This
// pins the semantics the report asks for so a later change cannot silently
// drop them.
describe("same-provider key fallback semantics (#2429)", () => {
  // The report's own key_retry_on list.
  it.each([
    ["429 rate limit", 429, ""],
    ["401 auth error", 401, ""],
    ["403 quota exhausted", 403, ""],
    ["quota exceeded body", 500, "quota exceeded for this key"],
  ])("%s rotates to the next key and cools the failed one", (_label, status, text) => {
    const { shouldFallback, cooldownMs } = checkFallbackError(status, text, 0);
    expect(shouldFallback).toBe(true);
    expect(cooldownMs).toBeGreaterThan(0);
  });

  it("a client-side error does NOT burn a key", () => {
    // Rotating here would drain an 8-key pool on one malformed request.
    expect(checkFallbackError(400, "invalid_request_error", 0)).toEqual({
      shouldFallback: false,
      cooldownMs: 0,
    });
  });

  it("repeat rate limits back the same key off further each time", () => {
    let level = 0;
    const seen = [];
    for (let i = 0; i < 4; i++) {
      const result = checkFallbackError(429, "", level);
      level = result.newBackoffLevel;
      seen.push(result.cooldownMs);
    }
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen[0]).toBe(BACKOFF_CONFIG.base);
    expect(seen.at(-1)).toBeLessThanOrEqual(BACKOFF_CONFIG.max);
    expect(getQuotaCooldown(BACKOFF_CONFIG.maxLevel + 5)).toBe(BACKOFF_CONFIG.max);
  });

  it("selects a live key while a sibling is cooling, and reports empty only when all are out", () => {
    const cooling = new Date(Date.now() + 60_000).toISOString();
    const pool = [
      { id: "key-a", rateLimitedUntil: cooling },
      { id: "key-b", rateLimitedUntil: null },
      { id: "key-c", rateLimitedUntil: new Date(Date.now() - 60_000).toISOString() },
    ];

    // Expired cooldown recovers on its own — the TTL recovery the report wants.
    expect(filterAvailableAccounts(pool).map((a) => a.id)).toEqual(["key-b", "key-c"]);
    // Exclusion is how the retry loop stops reusing the key it just failed on.
    expect(filterAvailableAccounts(pool, "key-b").map((a) => a.id)).toEqual(["key-c"]);

    const allOut = pool.map((a) => ({ ...a, rateLimitedUntil: cooling }));
    expect(filterAvailableAccounts(allOut)).toEqual([]);
    // Only at this point does the caller leave the provider, and it can say when
    // the pool comes back rather than returning a bare failure.
    expect(getEarliestRateLimitedUntil(allOut)).toBe(cooling);
  });

  it("a 429 marks the key unavailable, and success clears it", () => {
    const failed = applyErrorState({ id: "key-a", backoffLevel: 0 }, 429, "rate limit");
    expect(isAccountUnavailable(failed.rateLimitedUntil)).toBe(true);
    expect(failed.backoffLevel).toBe(1);
    expect(failed.status).toBe("error");

    const recovered = resetAccountState(failed);
    expect(recovered.rateLimitedUntil).toBeNull();
    expect(recovered.backoffLevel).toBe(0);
    expect(recovered.status).toBe("active");
  });

  it("a provider-wide or network failure rotates without burning the key", () => {
    // Not in the report, but it is the thing that makes a key pool survive: the
    // next key would hit the same capacity ceiling or the same dead proxy.
    for (const text of ["model_capacity_exhausted", "ECONNREFUSED", "[proxyFetch] proxy required but failed"]) {
      expect(checkFallbackError(503, text, 3)).toEqual({ shouldFallback: true, cooldownMs: 0 });
    }
  });
});
