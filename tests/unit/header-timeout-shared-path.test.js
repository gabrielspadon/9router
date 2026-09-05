import { describe, it, expect } from "vitest";
import { checkFallbackError, isSharedPathFailure } from "open-sse/services/accountFallback.js";
import { isValidConnectTimeoutMs, resolveConnectTimeoutMs } from "open-sse/config/connectTimeout.js";
import claudeRegistry from "open-sse/providers/registry/claude.js";

// Measured on RTX 2026-09-04, 601 requests across a 5-account Claude pool.
// Every one of the 7 requests carrying a ~150k-token prompt failed at exactly
// 15s; 599 of the 601 below that succeeded. Two independent defects stacked:
//
//   1. The response-header deadline defaulted to 15s for a provider that sends
//      no headers until prefill completes, so the budget scaled with nothing
//      while the prompt did. TTFT among the SUCCESSES reached p90 19487ms and
//      max 98109ms, i.e. the successful population was already crossing the
//      deadline that was killing its neighbours.
//   2. Each abort was then classified as a per-key failure, so a healthy
//      account took a LOCK.applied and the walk burned the pool one key per
//      attempt, turning one slow prefill into five upstream calls.
//
// The exact wire text, from formatProviderError, which renders `[502]:
// <message>` and DROPS error.code — which is why matching the undici code
// alone missed this.
const OUR_HEADER_TIMEOUT = "[502]: Upstream response headers exceeded 15000ms";

describe("our own response-header timeout is a shared-path failure", () => {
  it("is classified as shared-path, not as a credential fault", () => {
    expect(isSharedPathFailure(OUR_HEADER_TIMEOUT)).toBe(true);
  });

  it("rotates without locking the key or escalating backoff", () => {
    // cooldownMs 0 and no newBackoffLevel is what markAccountUnavailable reads
    // as an already-expired lock at an unchanged level.
    const res = checkFallbackError(502, OUR_HEADER_TIMEOUT, 0);
    expect(res.shouldFallback).toBe(true);
    expect(res.cooldownMs).toBe(0);
    expect(res.newBackoffLevel).toBeUndefined();
  });

  it("matches whatever timeout value the deadline reports", () => {
    // The message interpolates timeoutMs, so a per-provider override must not
    // fall back through to the 5s transient cooldown.
    for (const ms of [1000, 60000, 120000]) {
      expect(isSharedPathFailure(`[502]: Upstream response headers exceeded ${ms}ms`)).toBe(true);
    }
  });

  it("still locks a genuine per-key failure", () => {
    // The guard against over-broad matching: this must not swallow a real
    // credential fact.
    expect(checkFallbackError(401, "Unauthorized", 0).cooldownMs).toBeGreaterThan(0);
    expect(checkFallbackError(429, "rate limit exceeded", 0).newBackoffLevel).toBe(1);
  });
});

describe("the claude header deadline fits its own context window", () => {
  it("declares a registry timeout that survives validation", () => {
    // Above CONNECT_TIMEOUT_MAX_MS the value is silently dropped and the
    // resolver falls through, so an over-large number reads as a fix and is
    // not one.
    const declared = claudeRegistry.transport.timeoutMs;
    expect(isValidConnectTimeoutMs(declared)).toBe(true);
    expect(resolveConnectTimeoutMs({ registryTimeout: declared, envTimeout: 60000 })).toBe(declared);
  });

  it("clears the measured worst-case prefill", () => {
    // 98109ms was the slowest header latency that still SUCCEEDED in the
    // 2026-09-04 sample. A deadline under it aborts requests that were working.
    expect(claudeRegistry.transport.timeoutMs).toBeGreaterThan(98109);
  });

  it("is still overridable per provider from settings", () => {
    // providerOverride outranks the registry, so an operator can lower it.
    expect(resolveConnectTimeoutMs({
      providerOverride: 30000,
      registryTimeout: claudeRegistry.transport.timeoutMs,
      envTimeout: 60000,
    })).toBe(30000);
  });
});
