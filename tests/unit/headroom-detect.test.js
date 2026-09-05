import { describe, it, expect, vi, afterEach } from "vitest";

import { getHeadroomStatus, isLoopbackHeadroomUrl } from "../../src/lib/headroom/detect.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("headroom detect", () => {
  it("treats a reachable external proxy as running without any local probing", async () => {
    global.fetch = vi.fn(async () => new Response("ok", { status: 200 }));

    const status = await getHeadroomStatus("http://headroom:8787");

    expect(status.running).toBe(true);
    expect(status.localUrl).toBe(false);
    expect(global.fetch).toHaveBeenCalledWith("http://headroom:8787/health", expect.any(Object));
  });

  it("recognizes loopback URLs", () => {
    expect(isLoopbackHeadroomUrl("http://localhost:8787")).toBe(true);
    expect(isLoopbackHeadroomUrl("http://127.0.0.1:8787")).toBe(true);
    expect(isLoopbackHeadroomUrl("http://headroom:8787")).toBe(false);
    expect(isLoopbackHeadroomUrl("not-a-url")).toBe(false);
  });
});
