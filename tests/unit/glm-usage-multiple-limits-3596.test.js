import { describe, expect, it, vi } from "vitest";

let PAYLOAD;
vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: async () =>
    new Response(JSON.stringify(PAYLOAD), { status: 200, headers: { "Content-Type": "application/json" } }),
}));

const { getGlmUsage } = await import("open-sse/services/usage/misc.js");

// The parser wrote every TOKENS_LIMIT to the same "session" key, so an account
// returning more than one window reported only whichever came last and the rest
// vanished with no sign they had been dropped (#3596).
describe("GLM usage keeps every interval limit (#3596)", () => {
  it("two windows produce two entries", async () => {
    PAYLOAD = { data: { level: "pro", limits: [
      { type: "TOKENS_LIMIT", percentage: 20, nextResetTime: 1800000000000 },
      { type: "TOKENS_LIMIT", percentage: 75, nextResetTime: 1800009000000 },
    ] } };
    const out = await getGlmUsage("k", "glm");
    expect(Object.keys(out.quotas)).toEqual(["session", "session (2)"]);
    expect(out.quotas["session"].used).toBe(20);
    expect(out.quotas["session (2)"].used).toBe(75);
  });

  it("the single-window case is byte-for-byte what it was", async () => {
    PAYLOAD = { data: { level: "pro", limits: [
      { type: "TOKENS_LIMIT", percentage: 40, nextResetTime: 1800000000000 },
    ] } };
    const out = await getGlmUsage("k", "glm");
    expect(Object.keys(out.quotas)).toEqual(["session"]);
    expect(out.quotas.session).toEqual({
      used: 40, total: 100, remaining: 60, remainingPercentage: 60,
      resetAt: new Date(1800000000000).toISOString(), unlimited: false,
    });
  });

  it("remaining is derived per limit, not from the last one seen", async () => {
    PAYLOAD = { data: { level: "pro", limits: [
      { type: "TOKENS_LIMIT", percentage: 10, nextResetTime: 0 },
      { type: "TOKENS_LIMIT", percentage: 90, nextResetTime: 0 },
    ] } };
    const out = await getGlmUsage("k", "glm");
    expect(out.quotas["session"].remaining).toBe(90);
    expect(out.quotas["session (2)"].remaining).toBe(10);
  });

  it("a non-token limit is still skipped, and does not consume a key", async () => {
    // CREDIT_LIMIT is deliberately still dropped: its percentage semantics are
    // unverified here, and showing a wrong number is worse than showing none.
    PAYLOAD = { data: { level: "pro", limits: [
      { type: "CREDIT_LIMIT", percentage: 5 },
      { type: "TOKENS_LIMIT", percentage: 30, nextResetTime: 0 },
    ] } };
    const out = await getGlmUsage("k", "glm");
    expect(Object.keys(out.quotas)).toEqual(["session"]);
    expect(out.quotas.session.used).toBe(30);
  });

  it("the plan still comes through", async () => {
    PAYLOAD = { data: { level: "PRO", limits: [] } };
    const out = await getGlmUsage("k", "glm");
    expect(out.plan).toBe("Pro");
    expect(out.quotas).toEqual({});
  });
});
