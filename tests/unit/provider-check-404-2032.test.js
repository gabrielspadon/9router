import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const testUtils = readFileSync(new URL("../../src/app/api/providers/[id]/test/testUtils.js", import.meta.url), "utf8");

// A "Check" that accepted 404 reported a working connection for a model the
// upstream does not serve; the account was then model-locked for an hour on its
// first real request, with nothing having warned the user (#2032).
describe("provider Check rejects 404 uniformly (#2032)", () => {
  it("every status guard routes through the one predicate", () => {
    expect(testUtils).toContain("function credentialConfirmedByStatus(status)");
    // The hand-written form is what drifted: one branch had 404, eleven did not.
    expect(testUtils).not.toMatch(/res\.status !== 401 && res\.status !== 403/);
  });

  it("the predicate rejects 401, 403 and 404 and nothing else", () => {
    const rejected = testUtils.match(/CREDENTIAL_REJECTED_STATUSES = new Set\(\[([^\]]*)\]\)/);
    expect(rejected).not.toBeNull();
    expect(rejected[1].replace(/\s/g, "")).toBe("401,403,404");
    // 400 and 429 still confirm the credential: the request reached the account.
    expect(testUtils).toContain("400 and 429 still confirm the credential");
  });

  it("all twelve call sites were converted, none left behind", () => {
    const uses = testUtils.match(/credentialConfirmedByStatus\(res\.status\)/g) || [];
    expect(uses.length).toBe(12);
  });
});
