import { describe, expect, it } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

// #1884: with DNS redirection on, every request to cloudcode-pa.googleapis.com
// (chat AND account-setup/session calls) is intercepted by src/mitm/server.js.
// It used to force-rewrite the User-Agent + body.metadata.ideVersion on ALL of
// them via applyAntigravityIdeVersionOverride, including loadCodeAssist and
// onboardUser -- the calls Google's account-setup flow uses. That made Google
// see a different IDE fingerprint than the one that established the OAuth
// session, and it started asking the user to sign in again after restart.
// isAntigravityChatEndpoint is the gate server.js now uses to scope the
// override to chat turns only, leaving auth/session traffic untouched.
describe("Antigravity MITM auth passthrough (#1884)", () => {
  const { isAntigravityChatEndpoint } = require("../../src/mitm/antigravityIdeVersion.js");

  it("flags real Antigravity chat-turn URLs", () => {
    expect(isAntigravityChatEndpoint("/v1internal/models/gemini-pro-agent:generateContent")).toBe(true);
    expect(isAntigravityChatEndpoint("/v1internal/models/gemini-pro-agent:streamGenerateContent?alt=sse")).toBe(true);
  });

  it("does not flag account-setup/session URLs as chat turns", () => {
    // Same paths open-sse/providers/registry/antigravity.js uses for
    // loadCodeAssistEndpoint / onboardUserEndpoint.
    expect(isAntigravityChatEndpoint("/v1internal:loadCodeAssist")).toBe(false);
    expect(isAntigravityChatEndpoint("/v1internal:onboardUser")).toBe(false);
  });

  it("does not flag other Cloud Code Assist calls (quota, models list)", () => {
    expect(isAntigravityChatEndpoint("/v1internal:fetchAvailableModels")).toBe(false);
    expect(isAntigravityChatEndpoint("/v1internal:retrieveUserQuota")).toBe(false);
  });

  it("handles missing/non-string URLs without throwing", () => {
    expect(isAntigravityChatEndpoint(undefined)).toBe(false);
    expect(isAntigravityChatEndpoint(null)).toBe(false);
  });
});
