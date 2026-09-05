import { describe, it, expect, vi, beforeEach } from "vitest";

// P-F2: a quota cache miss used to await a live provider fetch (3s timeout)
// INSIDE the serialized selection queue, stalling every admission of the
// provider. Now a TTL-expired snapshot is served immediately (stale-while-
// revalidate) and the refresh runs deduped in the background; concurrent
// misses share one fetch. Fail-open is preserved: a rejecting refresh never
// throws into the caller.

vi.mock("open-sse/services/usage.js", () => ({
  getUsageForProvider: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/lib/localDb", () => ({
  updateProviderConnection: vi.fn().mockResolvedValue(undefined),
}));

import { evaluateQuota, _clearQuotaCache } from "@/sse/services/quotaGuard.js";
import { getUsageForProvider } from "open-sse/services/usage.js";

const okConn = (over = {}) => ({
  id: "c-pf2",
  provider: "claude",
  authType: "oauth",
  quotaPauseThresholds: {},
  ...over,
});

const staleSnapshot = () => ({
  windows: [{ key: "session (5h)", remainingPercentage: 20, resetAt: null, unlimited: false }],
  fetchedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // TTL is 2min
});

beforeEach(() => {
  vi.clearAllMocks();
  _clearQuotaCache();
});

describe("quota evidence stale-while-revalidate (P-F2)", () => {
  it("serves a stale snapshot synchronously and refreshes in the background", async () => {
    let resolveFetch;
    getUsageForProvider.mockImplementation(
      () => new Promise((r) => { resolveFetch = r; })
    );
    const r1 = await evaluateQuota(okConn({ lastQuotaSnapshot: staleSnapshot() }));
    // Returned without waiting for the provider fetch to resolve.
    expect(r1.snapshot?.windows?.[0]).toMatchObject({ key: "session (5h)", remainingPercentage: 20 });
    // rawUsage is never paired with evidence the live fetch did not produce.
    expect(r1.rawUsage).toBeNull();
    expect(getUsageForProvider).toHaveBeenCalledTimes(1);

    resolveFetch({ quotas: { "session (5h)": { used: 1, total: 100, remainingPercentage: 99 } } });
    await new Promise((r) => setTimeout(r, 20)); // let the background refresh land

    const r2 = await evaluateQuota(okConn({ lastQuotaSnapshot: staleSnapshot() }));
    expect(r2.snapshot?.windows?.[0]?.remainingPercentage).toBe(99);
    expect(getUsageForProvider).toHaveBeenCalledTimes(1); // refresh did not refetch
  });

  it("dedupes concurrent TTL-expired misses to one in-flight refresh", async () => {
    let resolveFetch;
    getUsageForProvider.mockImplementation(
      () => new Promise((r) => { resolveFetch = r; })
    );
    const conn = () => okConn({ lastQuotaSnapshot: staleSnapshot() });
    const [a, b] = await Promise.all([evaluateQuota(conn()), evaluateQuota(conn())]);
    expect(a.snapshot?.windows?.[0]?.remainingPercentage).toBe(20);
    expect(b.snapshot?.windows?.[0]?.remainingPercentage).toBe(20);
    expect(getUsageForProvider).toHaveBeenCalledTimes(1);
    resolveFetch({ quotas: { "session (5h)": { used: 1, total: 100, remainingPercentage: 99 } } });
    await new Promise((r) => setTimeout(r, 20));
  });

  it("dedupes a cold-start (no snapshot at all) fetch across concurrent misses", async () => {
    getUsageForProvider.mockResolvedValue({
      quotas: { "session (5h)": { used: 10, total: 100, remainingPercentage: 90 } },
    });
    const conn = okConn({ quotaPauseThresholds: { "session (5h)": 15 } });
    const [a, b] = await Promise.all([evaluateQuota(conn), evaluateQuota(conn)]);
    expect(getUsageForProvider).toHaveBeenCalledTimes(1);
    expect(a.snapshot?.windows?.[0]?.remainingPercentage).toBe(90);
    expect(b.snapshot?.windows?.[0]?.remainingPercentage).toBe(90);
    expect(a.paused).toBe(false);
  });

  it("fail-open: a rejecting background refresh never reaches the caller", async () => {
    getUsageForProvider.mockRejectedValue(new Error("provider down"));
    const r = await evaluateQuota(okConn({ lastQuotaSnapshot: staleSnapshot() }));
    expect(r.snapshot?.windows?.[0]?.remainingPercentage).toBe(20);
    await new Promise((res) => setTimeout(res, 20)); // let the rejection land
  });

  it("fail-open: a rejecting cold-start fetch still never pauses", async () => {
    getUsageForProvider.mockRejectedValue(new Error("provider down"));
    const r = await evaluateQuota(okConn({ quotaPauseThresholds: { "session (5h)": 15 } }));
    expect(r.paused).toBe(false);
    expect(r.reason).toBe("no-data");
  });
});
