import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const topology = readFileSync(
  new URL("../../src/app/(dashboard)/dashboard/usage/components/ProviderTopology.js", import.meta.url),
  "utf8",
);
const usageStats = readFileSync(
  new URL("../../src/shared/components/UsageStats.js", import.meta.url),
  "utf8",
);
const overview = readFileSync(
  new URL("../../src/app/(dashboard)/dashboard/usage/components/OverviewCards.js", import.meta.url),
  "utf8",
);

describe("usage topology carries a quantity", () => {
  it("receives the per-provider metrics the page already fetched", () => {
    // `stats.byProvider` is built in usageRepo and was reaching the page but
    // never the diagram, so the topology showed which upstreams exist without
    // showing where the traffic went.
    expect(usageStats).toContain("byProvider={stats.byProvider || {}}");
    expect(topology).toContain("byProvider = NO_METRICS");
  });

  it("keeps the layout memo stable when no metrics are passed", () => {
    // A `= {}` default is a fresh identity every render, which would defeat the
    // memo that guards a react-flow relayout.
    expect(topology).toContain("const NO_METRICS = Object.freeze({})");
  });

  it("matches provider keys case-insensitively", () => {
    // Everything else in this file lowercases before comparing; an exact match
    // here would silently render 0 requests for a differently-cased upstream.
    expect(topology).toContain("function metricFor(");
    expect(topology).toMatch(/key\.toLowerCase\(\) === wanted/);
  });

  it("keeps non-interactive edges out of the tab sequence", () => {
    expect(topology).toContain("edgesFocusable={false}");
  });
});

describe("usage overview cards", () => {
  it("routes every visible label through translate", () => {
    // The locale files are keyed by the English source text, so a literal that
    // never reaches translate() can never be translated at all.
    for (const label of [
      "Total Requests",
      "Total Input Tokens",
      "Cached Tokens",
      "Output Tokens",
      "Est. Cost",
      "Estimated, not actual billing",
    ]) {
      expect(overview).toContain(`translate("${label}")`);
    }
  });

  it("names the period beside the cost, so it cannot be read as the masthead Spend", () => {
    expect(overview).toContain("periodLabel");
    expect(usageStats).toMatch(/periodLabel=\{PERIODS\.find/);
  });
});
