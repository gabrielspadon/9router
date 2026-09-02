import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

const { POST: probeMcpTools } = await import("../../src/app/api/cli-tools/cowork-mcp-tools/route.js");

const post = (body) =>
  probeMcpTools(new Request("http://localhost/api/cli-tools/cowork-mcp-tools", {
    method: "POST",
    body: JSON.stringify(body),
  }));

// undici surfaces a connector/DNS rejection as TypeError("fetch failed") with the real
// reason on .cause — the shape createPublicOnlyLookup produces on a rebinding host.
const wrapAsFetchFailure = (cause) => Object.assign(new TypeError("fetch failed"), { cause });
const ssrfCause = () => Object.assign(new Error("Blocked URL: private IP"), { code: "ERR_SSRF_BLOCKED" });

describe("POST /api/cli-tools/cowork-mcp-tools SSRF guard", () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each([
    ["loopback", "http://127.0.0.1:20128/api/health"],
    ["loopback by name", "http://localhost:20128/dashboard"],
    ["cloud metadata", "http://169.254.169.254/latest/meta-data/iam/security-credentials/"],
    ["private 10/8", "http://10.0.0.5/admin"],
    ["private 192.168/16", "http://192.168.1.1/"],
    ["private 172.16/12", "http://172.16.0.1/"],
    ["carrier NAT 100.64/10", "http://100.64.0.1/"],
    ["IPv6 loopback", "http://[::1]:20128/"],
    ["IPv4-mapped IPv6 loopback", "http://[::ffff:127.0.0.1]/"],
    ["internal suffix", "http://mcp.internal/"],
    ["non-http protocol", "file:///etc/passwd"],
  ])("refuses %s with 400 and never dials", async (_label, url) => {
    const res = await post({ url });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/Blocked/i);
    expect(body.error).toMatch(/public/i);
    expect(body.tools).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps a DNS-rebinding refusal raised at connect time to 400, not a 200 with tools", async () => {
    fetchSpy.mockRejectedValueOnce(wrapAsFetchFailure(ssrfCause()));

    const res = await post({ url: "https://rebind.example.com/mcp" });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/Blocked/i);
  });

  it("still answers 200 with an error field for an ordinary upstream failure", async () => {
    fetchSpy.mockRejectedValueOnce(
      wrapAsFetchFailure(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })),
    );

    const res = await post({ url: "https://mcp.example.com/sse" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.error || "").not.toMatch(/Blocked/i);
  });

  it("probes a genuinely public MCP server and returns its tools", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
        status: 200, headers: { "content-type": "application/json", "mcp-session-id": "s1" },
      }))
      .mockResolvedValueOnce(new Response("", { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        jsonrpc: "2.0", id: 2, result: { tools: [{ name: "search", description: "find things" }] },
      }), { status: 200, headers: { "content-type": "application/json" } }));

    const res = await post({ url: "https://mcp.example.com/mcp" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tools).toEqual([{ name: "search", description: "find things" }]);
    expect(fetchSpy.mock.calls.every(([target]) => target === "https://mcp.example.com/mcp")).toBe(true);
  });

  it("still rejects a missing url without dialling", async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
