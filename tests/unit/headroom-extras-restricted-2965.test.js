import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const client = readFileSync(new URL("../../src/app/(dashboard)/dashboard/token-saver/TokenSaverClient.js", import.meta.url), "utf8");
const guard = readFileSync(new URL("../../src/dashboardGuard.js", import.meta.url), "utf8");

// /api/headroom/* is local-only, so a dashboard opened on a LAN address gets a
// 401. The client caught every failure alike and set extras to all-false, which
// the UI renders as "not installed" — sending people to hunt an install problem
// that did not exist.
describe("a local-only 401 is not reported as 'not installed' (#2965)", () => {
  it("gates every headroom path identically, so the asymmetry is gone", () => {
    expect(guard).toContain('"/api/headroom"');
    // Prefix matching means /api/headroom covers /extras and /status alike.
    expect(guard).toContain("LOCAL_ONLY_PATHS.some((p) => pathname.startsWith(p))");
  });

  it("separates the restricted case from a genuine failure", () => {
    expect(client).toContain("er.status === 401 || er.status === 403");
    expect(client).toContain("restricted: true,");
  });

  it("returns before the not-installed state is written", () => {
    const branch = client.slice(client.indexOf("er.status === 401 || er.status === 403"));
    const upToReturn = branch.slice(0, branch.indexOf("return;"));
    expect(upToReturn).toContain("restricted: true");
    expect(upToReturn).not.toContain("throw new Error");
  });

  it("clears the flag on a later successful read", () => {
    const ok = client.slice(client.indexOf("const ed = await er.json();"));
    expect(ok.slice(0, ok.indexOf("setPendingExtras([]);"))).toContain("restricted: false");
  });

  it("says what to do instead of showing empty extras", () => {
    expect(client).toContain("headroomExtras.restricted &&");
    expect(client).toMatch(/Not readable from this address/);
    // And the extras list is suppressed rather than rendered as all-absent.
    expect(client).toContain("!headroomExtras.restricted && headroomExtras.available.map");
  });

  it("a real failure still falls back to the unrestricted empty state", () => {
    const fallback = client.slice(client.indexOf("} catch {"));
    expect(fallback.slice(0, fallback.indexOf("setPendingExtras([]);"))).toContain("restricted: false");
  });
});
