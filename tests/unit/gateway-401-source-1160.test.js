import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const guard = readFileSync(new URL("../../src/dashboardGuard.js", import.meta.url), "utf8");

// A 401 raised by TokenProxy and a 401 relayed from an upstream provider rendered
// identically in clients, so a user could not tell whether to sign in to
// TokenProxy or to fix a provider credential (#1160).
describe("a gateway-raised 401 says so (#1160)", () => {
  it("declares one constant rather than repeating the literal", () => {
    expect(guard).toContain('const GATEWAY_ERROR_SOURCE = "tokenproxy";');
  });

  it("every 401 the guard raises carries it", () => {
    const four01s = guard.match(/status: 401/g) || [];
    const tagged = guard.match(/source: GATEWAY_ERROR_SOURCE/g) || [];
    expect(four01s.length).toBeGreaterThan(0);
    expect(tagged.length).toBe(four01s.length);
  });

  it("the messages that already distinguished the cases are unchanged", () => {
    // The text was the only signal before; it stays, so nothing that parsed it
    // breaks.
    expect(guard).toContain("Sign in required.");
    expect(guard).toContain("API key required for remote API access");
    expect(guard).toContain('error: "Unauthorized"');
  });

  it("the field is additive, never replacing error", () => {
    // A client reading `error` must keep working; this only adds a sibling.
    for (const m of guard.matchAll(/source: GATEWAY_ERROR_SOURCE/g)) {
      const around = guard.slice(Math.max(0, m.index - 220), m.index + 60);
      expect(around).toMatch(/error:/);
    }
  });
});
