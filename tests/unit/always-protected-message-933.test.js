import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const guard = readFileSync(new URL("../../src/dashboardGuard.js", import.meta.url), "utf8");
const route = readFileSync(new URL("../../src/app/api/settings/database/route.js", import.meta.url), "utf8");

// "Download Backup -> Unauthorized" is not a broken feature. /api/settings/database
// is in ALWAYS_PROTECTED, which requires a real session even when requireLogin is
// false, so with login disabled the button 401s by design. The bare "Unauthorized"
// is what made it read as a defect.
describe("the always-protected gate explains itself (#933)", () => {
  it("still gates the dangerous routes on a real identity", () => {
    // The boundary must not move: this is the GHSA-qvfm hardening.
    const block = guard.slice(guard.indexOf("if (ALWAYS_PROTECTED.some("));
    expect(block.slice(0, block.indexOf("}"))).toContain("hasValidCliToken(request)");
    expect(block.slice(0, block.indexOf("}"))).toContain("hasValidToken(request)");
  });

  it("deliberately does not honour requireLogin=false there", () => {
    const idx = guard.indexOf("const ALWAYS_PROTECTED");
    const block = guard.slice(idx, guard.indexOf("];", idx));
    expect(block).toContain("/api/settings/database");
    expect(block).toContain("/api/shutdown");
    // isAuthenticated() is the requireLogin-aware helper; this path must not use it.
    const gate = guard.slice(guard.indexOf("if (ALWAYS_PROTECTED.some("));
    expect(gate.slice(0, gate.indexOf("\n  }"))).not.toContain("isAuthenticated");
  });

  it("says why, instead of a bare Unauthorized", () => {
    const gate = guard.slice(guard.indexOf("if (ALWAYS_PROTECTED.some("));
    const body = gate.slice(0, gate.indexOf("\n  }"));
    expect(body).toContain("Sign in required");
    expect(body).not.toMatch(/error: "Unauthorized"/);
  });

  it("the export route keeps its second factor", () => {
    // Session alone is not enough; the dashboard password is still verified.
    expect(route).toContain("verifyDashboardPassword");
    expect(route).toContain("Boolean(identityOk) &&");
  });
});
