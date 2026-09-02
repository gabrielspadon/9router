import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { ERROR_RULES } from "../../open-sse/config/errorConfig.js";

// The free-tier abuse gate several providers use must rotate the account rather
// than surface to the client. Already handled by the generic "to prevent abuse"
// rule; pinned here so a reordering of ERROR_RULES cannot silently shadow it,
// since the classifier is first-match-wins.
const AIHUBMIX = "[Sorry, to prevent abuse of free resources, accounts that have not been recharged can only try 10 times. You can increase the free quota after recharging; https://console.aihubmix.com/topup]";

describe("free-tier abuse gates trigger account rotation (#3602)", () => {
  it("rotates on the reported message whatever status carries it", () => {
    for (const status of [200, 400, 403, 429]) {
      const r = checkFallbackError(status, AIHUBMIX, 0);
      expect(r.shouldFallback, `status ${status} did not rotate`).toBe(true);
      expect(r.cooldownMs).toBeGreaterThan(0);
    }
  });

  it("backs off rather than locking the account outright", () => {
    const r = checkFallbackError(403, AIHUBMIX, 0);
    expect(r.newBackoffLevel).toBe(1);
    expect(checkFallbackError(403, AIHUBMIX, 1).newBackoffLevel).toBe(2);
  });

  it("no rule before it matches this message first", () => {
    // First-match-wins, so a new `pass: true` rule inserted above that happens to
    // substring-match this text would silently stop the rotation.
    const lower = AIHUBMIX.toLowerCase();
    const idx = ERROR_RULES.findIndex((r) => r.text === "to prevent abuse");
    expect(idx).toBeGreaterThanOrEqual(0);
    const shadowing = ERROR_RULES.slice(0, idx).filter((r) => r.text && lower.includes(r.text));
    expect(shadowing).toEqual([]);
  });

  it("carries no duplicate rules, which are unreachable by construction", () => {
    const seen = new Set();
    const dups = [];
    for (const r of ERROR_RULES) {
      const k = JSON.stringify(r);
      if (seen.has(k)) dups.push(k);
      seen.add(k);
    }
    expect(dups).toEqual([]);
  });
});
