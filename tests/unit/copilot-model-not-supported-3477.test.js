import { describe, expect, it } from "vitest";
import { checkFallbackError } from "open-sse/services/accountFallback.js";

// GitHub Copilot answers a model its own catalog lists, but the account is not
// entitled to, with model_not_supported. That describes the MODEL, not the
// credential, so a lock would take every other model on that account down with
// it, and with several Copilot models in one combo the whole provider ends up
// unavailable while the token is perfectly valid (#3477).
//
// Current rules already get this right, by two independent routes: the body
// carries "invalid_request_error", and the status rule for 400 passes as well.
// Neither is written down anywhere, both are order-dependent, and the failure
// they prevent is a silent lockout rather than an error — so pin the behaviour
// rather than the rule that happens to deliver it today.
const copilotBody = (message, code) => ({
  error: { message, code, param: "model", type: "invalid_request_error" },
});

describe("a model-scoped rejection does not cost the account (#3477)", () => {
  it("the exact Copilot body does not lock", () => {
    const r = checkFallbackError(400, copilotBody("The requested model is not supported.", "model_not_supported"));
    expect(r.shouldFallback).toBe(false);
    expect(r.cooldownMs).toBe(0);
  });

  it("the bare code does too, so a body without the type field is still safe", () => {
    expect(checkFallbackError(400, "model_not_supported").shouldFallback).toBe(false);
  });

  it("and the prose form", () => {
    expect(checkFallbackError(400, "The requested model is not supported.").shouldFallback).toBe(false);
  });

  it("the neighbouring model-scoped codes still pass, unchanged", () => {
    for (const t of ["model_not_found", "model not found", "unknown model", "no such model"])
      expect(checkFallbackError(400, t).shouldFallback).toBe(false);
  });

  it("a real credential failure still locks, which is the line this must not cross", () => {
    const r = checkFallbackError(401, "Unauthorized");
    expect(r.shouldFallback).toBe(true);
    expect(r.cooldownMs).toBeGreaterThan(0);
  });

  it("a rate limit still backs off rather than passing", () => {
    const r = checkFallbackError(429, "rate limit exceeded");
    expect(r.shouldFallback).toBe(true);
    expect(r.cooldownMs).toBeGreaterThan(0);
  });
});
