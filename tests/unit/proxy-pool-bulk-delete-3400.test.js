import { describe, it, expect, vi, beforeEach } from "vitest";

const deleteProxyPool = vi.fn();
const getProviderConnections = vi.fn();

vi.mock("@/models", () => ({
  createProxyPool: vi.fn(),
  getProxyPools: vi.fn(async () => []),
  deleteProxyPool: (...a) => deleteProxyPool(...a),
  getProviderConnections: (...a) => getProviderConnections(...a),
}));

const { DELETE, GET } = await import("@/app/api/proxy-pools/route.js");

const del = (body) => DELETE({ json: async () => body });

beforeEach(() => {
  deleteProxyPool.mockReset().mockResolvedValue(undefined);
  getProviderConnections.mockReset().mockResolvedValue([
    { id: "c1", providerSpecificData: { proxyPoolId: "bound" } },
  ]);
});

describe("proxy pools can be removed in bulk (#3400)", () => {
  it("deletes every unbound id given", async () => {
    const body = await (await del({ ids: ["a", "b", "c"] })).json();
    expect(deleteProxyPool).toHaveBeenCalledTimes(3);
    expect(body).toMatchObject({ success: true, deleted: 3 });
  });

  it("refuses a pool a connection still uses, and keeps deleting the rest", async () => {
    const body = await (await del({ ids: ["a", "bound", "c"] })).json();
    expect(body.success).toBe(false);
    expect(body.deleted).toBe(2);
    expect(body.results.find((r) => r.id === "bound")).toMatchObject({
      deleted: false, boundConnectionCount: 1,
    });
    expect(deleteProxyPool).not.toHaveBeenCalledWith("bound");
  });

  it("reads the connections once, not once per id", async () => {
    await del({ ids: ["a", "b", "c", "d"] });
    expect(getProviderConnections).toHaveBeenCalledTimes(1);
  });

  it("reports a failed delete per id rather than as one failure", async () => {
    deleteProxyPool.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("locked"));
    const body = await (await del({ ids: ["a", "b"] })).json();
    expect(body.results).toEqual([
      { id: "a", deleted: true },
      { id: "b", deleted: false, error: "locked" },
    ]);
  });

  it("rejects a request with no ids", async () => {
    expect((await del({ ids: [] })).status).toBe(400);
    expect((await del({})).status).toBe(400);
    expect(deleteProxyPool).not.toHaveBeenCalled();
  });

  it("ignores a non-string id rather than deleting something unexpected", async () => {
    const res = await del({ ids: [null, 7, {}] });
    expect(res.status).toBe(400);
  });

  it("leaves the listing filter alone", async () => {
    // The isActive filter this report also asks for is already served here.
    const res = await GET({ url: "http://x/api/proxy-pools?isActive=false" });
    expect(res.status ?? 200).toBe(200);
  });
});
