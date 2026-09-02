import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FREE_PROVIDERS, FREE_TIER_PROVIDERS } from "../../src/shared/constants/providers.js";

const route = readFileSync(new URL("../../src/app/api/providers/test-batch/route.js", import.meta.url), "utf8");
const page = readFileSync(new URL("../../src/app/(dashboard)/dashboard/providers/page.js", import.meta.url), "utf8");

// The dashboard's "Free Tier Providers" section renders both categories and its
// Test All sends mode "free". getAuthGroup answered "free" only for
// FREE_PROVIDERS, so every freeTier provider was skipped by the button directly
// above it and tested by the API-key button instead.
describe("Test All covers every provider in the free-tier section (#2680)", () => {
  it("the two categories are genuinely different sets", () => {
    // If they overlapped entirely there would be nothing to fix.
    const free = Object.keys(FREE_PROVIDERS);
    const tier = Object.keys(FREE_TIER_PROVIDERS);
    expect(tier.length).toBeGreaterThan(0);
    expect(tier.some((k) => !free.includes(k))).toBe(true);
  });

  it("the section renders both, which is why both must answer to one mode", () => {
    expect(page).toContain("freeEntries.length > 0 || freeTierEntries.length > 0");
    expect(page).toContain('handleBatchTest("free")');
  });

  it("the batch route groups both as free", () => {
    expect(route).toContain("FREE_TIER_PROVIDERS");
    expect(route).toContain("function isFreeGroup(providerId)");
    expect(route).toContain("FREE_PROVIDERS[providerId] || FREE_TIER_PROVIDERS[providerId]");
  });

  it("uses the shared predicate on both paths, not just the fallback", () => {
    // The connection-authType path decides "free" vs "oauth" too, and checking
    // only one of the two would leave oauth-shaped free-tier connections wrong.
    const fn = route.slice(route.indexOf("function getAuthGroup"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect((body.match(/isFreeGroup\(providerId\)/g) || []).length).toBe(2);
  });

  it("does not reclassify anything that was already correct", () => {
    expect(route).toContain('if (OAUTH_PROVIDERS[providerId]) return "oauth";');
    expect(route).toContain('if (APIKEY_PROVIDERS[providerId]) return "apikey";');
  });
});
