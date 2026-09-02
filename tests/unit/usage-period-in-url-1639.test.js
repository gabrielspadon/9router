// Issue #1639: the usage figures changed underneath the reader. The period was
// component state while the tab was in the URL, so any remount — a back
// navigation, a refresh, a shared link — silently reset the window to "today"
// and the numbers on screen were no longer the ones that had been asked for.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../../src/app/(dashboard)/dashboard/usage/page.js", import.meta.url), "utf8");

describe("the usage period survives a remount (#1639)", () => {
  it("is read from the URL, not from component state", () => {
    expect(page).toContain('searchParams.get("period")');
    expect(page).not.toMatch(/useState\(\s*"today"\s*\)/);
  });

  it("is written to the URL when it changes, the way the tab already is", () => {
    expect(page).toContain('pushParam("period", value)');
    expect(page).toContain('pushParam("tab", value)');
  });

  it("validates against the offered periods rather than trusting the URL", () => {
    // A hand-edited or stale link must not reach the API as an unknown window.
    expect(page).toContain("PERIODS.some((p) => p.value === periodFromUrl)");
    expect(page).toMatch(/:\s*"today"/);
  });

  it("keeps every period the picker offers reachable by link", () => {
    for (const value of ["today", "24h", "7d", "30d", "60d", "all"]) {
      expect(page).toContain(`value: "${value}"`);
    }
  });

  it("still hands UsageStats the resolved period", () => {
    expect(page).toContain("period={period}");
    expect(page).toContain("setPeriod={setPeriod}");
  });
});
