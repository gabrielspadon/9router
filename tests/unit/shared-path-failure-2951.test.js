import { describe, it, expect } from "vitest";
import { checkFallbackError, isSharedPathFailure } from "open-sse/services/accountFallback.js";

// #2951 finding 1: an 8-key NVIDIA pool drained itself because failures that no
// key could have fixed (provider model capacity, a dead proxy, a DNS/connect
// refusal) were classified as credential failures, so every key in turn got a
// persistent modelLock_* and an escalated backoffLevel.
//
// The contract asserted here: still rotate (so combo/account fallback advances)
// but leave nothing persistent behind. markAccountUnavailable derives the lock
// expiry from cooldownMs and the stored level from newBackoffLevel, so
// cooldownMs 0 with no newBackoffLevel is an already-expired lock and an
// unchanged backoff level.
const NVIDIA_CAPACITY = JSON.stringify({
  error: { code: "MODEL_CAPACITY_EXHAUSTED", message: "The model is at capacity" },
});
const STRICT_PROXY = "[502]: [ProxyFetch] Proxy required but failed (strictProxy=true): connect ECONNREFUSED";
const DNS_FAILURE = "[502]: fetch failed (cause: ENOTFOUND: getaddrinfo ENOTFOUND integrate.api.nvidia.com)";
const CONNECT_REFUSED = "[502]: fetch failed (cause: ECONNREFUSED: connect ECONNREFUSED 127.0.0.1:8080)";
const CONNECT_TIMEOUT = "[502]: fetch failed (cause: UND_ERR_CONNECT_TIMEOUT: Connect Timeout Error)";

describe("#2951 shared-path failures do not drain a multi-key pool", () => {
  it.each([
    ["nvidia model capacity", NVIDIA_CAPACITY],
    ["strictProxy refusal", STRICT_PROXY],
    ["dns failure", DNS_FAILURE],
    ["connect refused", CONNECT_REFUSED],
    ["connect timeout", CONNECT_TIMEOUT],
  ])("%s rotates without locking the key", (_label, errorText) => {
    const res = checkFallbackError(502, errorText, 0);
    expect(res.shouldFallback).toBe(true);
    expect(res.cooldownMs).toBe(0);
    expect(res.newBackoffLevel).toBeUndefined();
  });

  it("does not escalate an already-raised backoff level", () => {
    expect(checkFallbackError(429, NVIDIA_CAPACITY, 6)).toEqual({ shouldFallback: true, cooldownMs: 0 });
  });

  it("classifies a non-string error body", () => {
    expect(isSharedPathFailure({ error: { code: "model_capacity_exhausted" } })).toBe(true);
    expect(isSharedPathFailure(null)).toBe(false);
    expect(isSharedPathFailure("Invalid API key provided")).toBe(false);
  });

  it("leaves genuine per-key failures locking as before", () => {
    // Credential scope: still a real lock.
    expect(checkFallbackError(401, "Unauthorized", 0).cooldownMs).toBeGreaterThan(0);
    // Account quota: still exponential backoff.
    expect(checkFallbackError(429, "rate limit exceeded", 0).newBackoffLevel).toBe(1);
    // Generic capacity wording keeps the existing backoff rule; only the
    // structured provider code is treated as pool-wide.
    expect(checkFallbackError(422, "upstream capacity is exhausted", 1).newBackoffLevel).toBe(2);
    // Request scope is unchanged: returned once, no rotation.
    expect(checkFallbackError(400, "invalid_request_error", 0).shouldFallback).toBe(false);
  });
});
