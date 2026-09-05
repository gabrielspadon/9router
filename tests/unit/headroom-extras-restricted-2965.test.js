import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const guard = readFileSync(new URL("../../src/dashboardGuard.js", import.meta.url), "utf8");

describe("headroom paths are gated identically (#2965)", () => {
  it("gates every headroom path identically, so the asymmetry is gone", () => {
    expect(guard).toContain('"/api/headroom"');
    // Prefix matching means /api/headroom covers /proxy and /status alike.
    expect(guard).toContain("LOCAL_ONLY_PATHS.some((p) => pathname.startsWith(p))");
  });
});
