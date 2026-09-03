// A permanent fault must not advertise a recovery timer, in the header OR the body.
//
// Two independent leaks, both measured live against the running front:
//
//   1. 404 was absent from NEVER_RETRY_STATUSES, so an unknown model answered
//      `HTTP/1.1 404 Not Found` with `retry-after: 120`. error.js states the set
//      is "the same set ERROR_RULES marks pass:true plus the [ones] that earn a
//      long account cooldown", and errorConfig.js gives 404 COOLDOWN.long right
//      beside 401/402/403 -- so 404 belonged in the set by the file's own
//      derivation and had simply been dropped.
//
//   2. unavailableResponse built its message as `${message} (${retryAfterHuman})`
//      unconditionally. The header gate was already correct, so a 401/402/403
//      came back with NO Retry-After header but still carried
//      "(reset after 1m 53s)" in the body text. Header and body contradicted
//      each other, and a revoked credential read as a timed outage.
import { describe, expect, it } from "vitest";

import {
  NEVER_RETRY_STATUSES,
  errorResponse,
  isRetryableStatus,
  unavailableResponse,
} from "open-sse/utils/error.js";
import { isDeterministicClientError } from "open-sse/services/accountFallback.js";

const realReset = () => new Date(Date.now() + 113_000).toISOString();

describe("G-RETRY - a permanent fault never advertises a recovery timer", () => {
  it("classifies 404 as terminal: a model that does not exist is not created by waiting", () => {
    expect(isRetryableStatus(404)).toBe(false);
    expect(NEVER_RETRY_STATUSES.has(404)).toBe(true);
  });

  it("keeps the transient statuses retryable", () => {
    for (const status of [408, 409, 425, 429, 500, 502, 503, 504]) {
      expect(isRetryableStatus(status), `status ${status}`).toBe(true);
    }
  });

  it("strips Retry-After from a 404 even when a real lock expiry is supplied", () => {
    const res = errorResponse(404, "no such model", { retryAfter: { at: realReset() } });
    expect(res.status).toBe(404);
    expect(res.headers.get("Retry-After")).toBeNull();
  });

  it("omits the human reset text from a terminal body, not just the header", async () => {
    // The decisive case. The instant is genuine -- an account really is locked
    // until then -- and it still must not reach a caller whose correct action is
    // to fix the credential rather than to wait.
    for (const status of [401, 402, 403, 404]) {
      const res = unavailableResponse(status, "[deepseek/deepseek-chat] Provider error (401)", realReset(), "reset after 1m 53s");
      expect(res.status, `status ${status}`).toBe(status);
      expect(res.headers.get("Retry-After"), `status ${status}`).toBeNull();
      const body = await res.json();
      expect(body.error.message, `status ${status}`).not.toMatch(/reset after/i);
    }
  });

  it("still tells a genuinely rate-limited caller when to come back", async () => {
    // The fix must not silence the case the machinery exists for.
    for (const status of [429, 503]) {
      const res = unavailableResponse(status, "[deepseek/deepseek-chat] rate limited", realReset(), "reset after 1m 53s");
      expect(res.headers.get("Retry-After"), `status ${status}`).not.toBeNull();
      const body = await res.json();
      expect(body.error.message, `status ${status}`).toMatch(/reset after 1m 53s/);
    }
  });

  it("keeps the two 4xx classifiers consistent for 404", () => {
    // NEVER_RETRY_STATUSES gates whether a refusal may advertise a wait;
    // isDeterministicClientError gates provider fallback and model cooldown.
    // 404 must read the same way to both: no wait advertised, and no same-account
    // replay. Rotation to a DIFFERENT credential is unaffected and still runs.
    expect(isDeterministicClientError(404)).toBe(true);
  });
});
