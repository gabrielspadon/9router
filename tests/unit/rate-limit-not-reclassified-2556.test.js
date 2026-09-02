import { describe, it, expect } from "vitest";
import { checkFallbackError } from "open-sse/services/accountFallback.js";

describe("a 429 is decided by its status, not by its body text (#2556)", () => {
  it("falls back on a plain rate limit", () => {
    const r = checkFallbackError(429, "Rate limit exceeded");
    expect(r.shouldFallback).toBe(true);
    expect(r.cooldownMs).toBeGreaterThan(0);
  });

  for (const body of [
    '{"error":{"type":"invalid_request_error","message":"rate limited"}}',
    "Bad request: too many requests",
    "unknown model quota exhausted, retry later",
    "maximum context length reached the rate limit",
  ]) {
    it(`falls back even when the body reads "${body.slice(0, 34)}"`, () => {
      // These substrings all match a pass rule that runs before the status
      // rules, which is how a rate limit became a terminal client error and
      // stopped a combo on its first member.
      const r = checkFallbackError(429, body);
      expect(r.shouldFallback).toBe(true);
    });
  }

  it("raises the backoff level, so a repeat waits longer", () => {
    const first = checkFallbackError(429, "rate limited", 0);
    const later = checkFallbackError(429, "rate limited", 3);
    expect(later.newBackoffLevel).toBeGreaterThan(first.newBackoffLevel);
    expect(later.cooldownMs).toBeGreaterThanOrEqual(first.cooldownMs);
  });

  it("leaves a genuine client error on another status alone", () => {
    expect(checkFallbackError(400, "invalid_request_error").shouldFallback).toBe(false);
    expect(checkFallbackError(422, "unsupported parameter").shouldFallback).toBe(false);
  });

  it("still lets a shared-path failure rotate without a lock", () => {
    const r = checkFallbackError(500, "MODEL_CAPACITY_EXHAUSTED");
    expect(r.shouldFallback).toBe(true);
    expect(r.cooldownMs).toBe(0);
  });
});
