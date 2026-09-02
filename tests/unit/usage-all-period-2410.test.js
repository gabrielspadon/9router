import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../../src/app/(dashboard)/dashboard/usage/page.js", import.meta.url), "utf8");
const route = readFileSync(new URL("../../src/app/api/usage/stats/route.js", import.meta.url), "utf8");
const repo = readFileSync(new URL("../../src/lib/db/repos/usageRepo.js", import.meta.url), "utf8");

const uiPeriods = () => {
  const block = page.slice(page.indexOf("const PERIODS = ["), page.indexOf("];", page.indexOf("const PERIODS = [")));
  return [...block.matchAll(/value:\s*"([^"]+)"/g)].map((m) => m[1]);
};
const apiPeriods = () => {
  const line = route.split("\n").find((l) => l.includes("VALID_PERIODS"));
  return [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
};

// The API accepted "all" and the repo implemented it (periodCutoffIso returns
// null, meaning no lower bound), but the picker never offered it — so all-time
// usage was unreachable from the dashboard.
describe("the usage picker offers every period the API accepts (#2410)", () => {
  it("offers all-time", () => {
    expect(uiPeriods()).toContain("all");
  });

  it("offers nothing the API would reject", () => {
    const api = apiPeriods();
    for (const p of uiPeriods()) expect(api, `UI offers ${p}, API does not accept it`).toContain(p);
  });

  it("omits nothing the API accepts", () => {
    const ui = uiPeriods();
    for (const p of apiPeriods()) expect(ui, `API accepts ${p}, UI does not offer it`).toContain(p);
  });

  it("the repo really implements all-time as an unbounded range", () => {
    expect(repo).toContain('or null for "all"');
    expect(repo).toContain('getUsageStats(period = "all")');
  });
});
