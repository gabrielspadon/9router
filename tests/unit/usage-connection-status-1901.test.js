import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../src/app/api/usage/[connectionId]/route.js", import.meta.url), "utf8");

// Quota numbers alone do not say whether routing will USE an account. A
// connection can be disabled or model-locked after a failure while the tracker
// still shows a healthy remaining percentage, so an account being skipped looked
// identical to one with quota to spare (#1901).
describe("per-connection usage carries the DB status (#1901)", () => {
  it("the response is additive: usage keeps its own shape", () => {
    // Anything reading usage.quotas / usage.plan must not have to change.
    expect(src).toContain("...usage,");
    expect(src).toContain("connectionStatus: {");
  });

  it("it reports whether the connection is enabled", () => {
    // isActive is only false when explicitly disabled; absent means enabled, so
    // a plain truthiness test would report every untouched connection disabled.
    expect(src).toContain("isActive: connection.isActive !== false,");
  });

  it("it reports live model locks", () => {
    expect(src).toContain('key.startsWith("modelLock_")');
    expect(src).toContain('model: key.slice("modelLock_".length)');
  });

  it("an expired lock is not reported as a lock", () => {
    // Locks are cleared lazily, so a stale key would otherwise show an account
    // as excluded when nothing excludes it.
    expect(src).toContain("return Number.isFinite(at) && at > now;");
  });

  it("it reuses the snapshot routing reads rather than deriving its own", () => {
    // quotaGuard consumes lastQuotaSnapshot; the UI showing a different
    // computation is how the two drift.
    expect(src).toContain("lastQuotaSnapshot: snapshot ?? connection.lastQuotaSnapshot ?? null,");
  });

  it("the snapshot is still persisted for routing", () => {
    const persist = src.indexOf("lastQuotaSnapshot: snapshot }");
    const respond = src.indexOf("connectionStatus: {");
    expect(persist).toBeGreaterThan(0);
    expect(persist).toBeLessThan(respond);
  });
});

// The lock filter, exercised directly.
describe("live model locks are selected by expiry", () => {
  const liveLocks = (connection, now) =>
    Object.entries(connection)
      .filter(([key, until]) => key.startsWith("modelLock_") && until)
      .map(([key, until]) => ({ model: key.slice("modelLock_".length), until }))
      .filter(({ until }) => {
        const at = Date.parse(until);
        return Number.isFinite(at) && at > now;
      });

  const now = Date.parse("2026-08-31T06:00:00Z");

  it("keeps a lock that has not expired", () => {
    expect(liveLocks({ "modelLock_gpt-5.5": "2026-08-31T07:00:00Z" }, now))
      .toEqual([{ model: "gpt-5.5", until: "2026-08-31T07:00:00Z" }]);
  });

  it("drops one that has", () => {
    expect(liveLocks({ "modelLock_gpt-5.5": "2026-08-31T05:00:00Z" }, now)).toEqual([]);
  });

  it("ignores unparseable and empty values instead of throwing", () => {
    expect(liveLocks({ "modelLock_a": "not-a-date", "modelLock_b": "", "modelLock_c": null }, now)).toEqual([]);
  });

  it("ignores every non-lock field on the connection", () => {
    expect(liveLocks({ id: "c1", isActive: true, accessToken: "x" }, now)).toEqual([]);
  });

  it("keeps a model id that itself contains an underscore", () => {
    expect(liveLocks({ "modelLock_gpt_oss_120b": "2026-08-31T07:00:00Z" }, now)[0].model)
      .toBe("gpt_oss_120b");
  });
});
