import { describe, it, expect, vi } from "vitest";

vi.mock("@/dashboardGuard", () => ({ proxy: vi.fn() }));

const { default: proxy } = await import("@/proxy.js");
const { proxy: guard } = await import("@/dashboardGuard");

const request = { nextUrl: { pathname: "/api/providers/test" } };

describe("middleware answers in JSON even when the guard throws (#3441)", () => {
  it("returns a 500 whose body parses as JSON", async () => {
    guard.mockRejectedValueOnce(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await proxy(request);
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    // The dashboard reads this with res.json(); Next's own plain-text
    // "Internal Server Error" is what produced the reported parse failure.
    await expect(res.json()).resolves.toEqual({ error: "Request could not be processed" });
  });

  it("does not leak the thrown message to the caller", async () => {
    guard.mockRejectedValueOnce(new Error("connection string with a secret"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await proxy(request);
    spy.mockRestore();
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });

  it("passes a normal response straight through", async () => {
    const ok = new Response(null, { status: 204 });
    guard.mockResolvedValueOnce(ok);
    expect(await proxy(request)).toBe(ok);
  });
});
