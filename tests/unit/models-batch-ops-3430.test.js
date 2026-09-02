import { describe, it, expect, vi, beforeEach } from "vitest";

const deleteCustomModel = vi.fn();
const refreshModelCapabilityOverrides = vi.fn();
const pingModelByKind = vi.fn();

vi.mock("@/models", () => ({
  getCustomModels: vi.fn(),
  addCustomModel: vi.fn(),
  deleteCustomModel: (...a) => deleteCustomModel(...a),
}));
vi.mock("@/lib/modelCapabilityOverrides", () => ({
  refreshModelCapabilityOverrides: (...a) => refreshModelCapabilityOverrides(...a),
}));
vi.mock("@/app/api/models/test/ping", () => ({
  pingModelByKind: (...a) => pingModelByKind(...a),
}));

const customRoute = await import("@/app/api/models/custom/route.js");
const testRoute = await import("@/app/api/models/test/route.js");

const del = (qs) => customRoute.DELETE({ url: `http://x/api/models/custom?${qs}` });
const post = (body) => testRoute.POST({ json: async () => body });

beforeEach(() => {
  deleteCustomModel.mockReset().mockResolvedValue(undefined);
  refreshModelCapabilityOverrides.mockReset().mockResolvedValue(undefined);
  pingModelByKind.mockReset();
});

describe("custom model deletion accepts a batch (#3430)", () => {
  it("deletes every id given and reports the count", async () => {
    const body = await (await del("providerAlias=p&id=a&id=b&id=c")).json();
    expect(deleteCustomModel).toHaveBeenCalledTimes(3);
    expect(body).toMatchObject({ success: true, deleted: 3 });
  });

  it("still answers a single id the way it always did", async () => {
    const body = await (await del("providerAlias=p&id=a")).json();
    expect(body.success).toBe(true);
    expect(deleteCustomModel).toHaveBeenCalledWith({ providerAlias: "p", id: "a", type: "llm" });
  });

  it("reports a partial batch per id rather than as one failure", async () => {
    deleteCustomModel.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("gone"));
    const body = await (await del("providerAlias=p&id=a&id=b")).json();
    expect(body.success).toBe(false);
    expect(body.deleted).toBe(1);
    expect(body.results).toEqual([
      { id: "a", success: true },
      { id: "b", success: false, error: "gone" },
    ]);
  });

  it("refreshes the capability overrides once, not once per id", async () => {
    await del("providerAlias=p&id=a&id=b&id=c");
    expect(refreshModelCapabilityOverrides).toHaveBeenCalledTimes(1);
  });

  it("rejects a request with no id at all", async () => {
    const res = await del("providerAlias=p");
    expect(res.status).toBe(400);
    expect(deleteCustomModel).not.toHaveBeenCalled();
  });
});

describe("model test accepts a batch (#3430)", () => {
  it("keeps the single-model response shape unchanged", async () => {
    pingModelByKind.mockResolvedValue({ ok: true, latency: 12 });
    expect(await (await post({ model: "p/m" })).json()).toEqual({ ok: true, latency: 12 });
  });

  it("returns one result per model, tagged with its id", async () => {
    pingModelByKind.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false });
    const body = await (await post({ models: ["a", "b"] })).json();
    expect(body.ok).toBe(false);
    expect(body.results).toEqual([{ model: "a", ok: true }, { model: "b", ok: false }]);
  });

  it("pings sequentially, because a burst is what trips the upstream limiter", async () => {
    let live = 0;
    let peak = 0;
    pingModelByKind.mockImplementation(async () => {
      live++; peak = Math.max(peak, live);
      await Promise.resolve();
      live--;
      return { ok: true };
    });
    await post({ models: ["a", "b", "c"] });
    expect(peak).toBe(1);
  });

  it("keeps going when one model throws", async () => {
    pingModelByKind.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ ok: true });
    const body = await (await post({ models: ["a", "b"] })).json();
    expect(body.results[0]).toEqual({ model: "a", ok: false, error: "boom" });
    expect(body.results[1]).toEqual({ model: "b", ok: true });
  });

  it("rejects a request naming nothing", async () => {
    expect((await post({ models: [] })).status).toBe(400);
  });
});

describe("the same endpoint runs a custom prompt (#3438, #3140)", () => {
  it("passes the caller's prompt to a single model and returns its answer", async () => {
    pingModelByKind.mockResolvedValue({ ok: true, preview: "42" });
    const body = await (await post({ model: "p/m", prompt: "what is 6 times 7" })).json();
    expect(pingModelByKind).toHaveBeenCalledWith("p/m", "llm", undefined, "what is 6 times 7");
    expect(body.preview).toBe("42");
  });

  it("runs one prompt across several models so the answers can be compared", async () => {
    pingModelByKind.mockResolvedValue({ ok: true, preview: "x" });
    await post({ models: ["a", "b"], prompt: "hello" });
    expect(pingModelByKind.mock.calls.map((c) => [c[0], c[3]])).toEqual([
      ["a", "hello"],
      ["b", "hello"],
    ]);
  });

  it("falls back to the fixed probe for an empty or whitespace prompt", async () => {
    pingModelByKind.mockResolvedValue({ ok: true });
    await post({ model: "p/m", prompt: "   " });
    await post({ model: "p/m", prompt: 7 });
    expect(pingModelByKind.mock.calls.every((c) => c[3] === null)).toBe(true);
  });
});
