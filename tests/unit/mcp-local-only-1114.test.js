import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Issue #1114. The MCP routes drive stdio plugins, so reaching them means
// talking to a local child process: a lapse here is remote code execution, not
// a data leak. dashboardGuard restricts /api/mcp/ through LOCAL_ONLY_PATHS, but
// that is one list in one file, and a config change or a new sibling route
// removes the only check. These assert the handler refuses on its own.

vi.hoisted(() => {
  process.env.JWT_SECRET ||= "test-only-jwt-secret-not-a-credential-000000";
  process.env.TOKENPROXY_PEER_TOKEN = "peer-secret-for-test";
});

// The routes import the stdio bridge, which does require("@/shared/constants/…"),
// a CommonJS require against a build-time alias that vitest cannot resolve. The
// guard under test does not touch the bridge, so it is stubbed out rather than
// dragging a Next build resolution quirk into a security test.
vi.mock("@/lib/mcp/stdioSseBridge", () => ({
  findPlugin: () => null,
  registerSession: () => "sid",
  unregisterSession: () => {},
  sendToChild: () => {},
}));

const PEER = "peer-secret-for-test";

function req(headers = {}) {
  return new Request("http://localhost:20128/api/mcp/demo/sse", { headers });
}
function postReq(headers = {}) {
  return new Request("http://localhost:20128/api/mcp/demo/message", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
  });
}
const params = { params: Promise.resolve({ plugin: "demo" }) };

let prevEnv;
beforeEach(() => { prevEnv = process.env.NODE_ENV; });
afterEach(() => { process.env.NODE_ENV = prevEnv; vi.restoreAllMocks(); });

describe("MCP routes refuse non-local callers on their own (#1114)", () => {
  it("sse returns 403 for a remote caller", async () => {
    const { GET } = await import("../../src/app/api/mcp/[plugin]/sse/route.js");
    const res = await GET(req({ host: "example.com", origin: "https://example.com" }), params);

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Local only: MCP requires localhost access");
  });

  it("message returns 403 for a remote caller", async () => {
    const { POST } = await import("../../src/app/api/mcp/[plugin]/message/route.js");
    const res = await POST(postReq({ host: "example.com", origin: "https://example.com" }), params);

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Local only: MCP requires localhost access");
  });

  it("refuses a spoofed peer ip that carries no proof token", async () => {
    const { GET } = await import("../../src/app/api/mcp/[plugin]/sse/route.js");
    // x-tp-real-ip is attacker-supplied unless custom-server.js stamped it with
    // the per-boot secret, so on its own it must buy nothing.
    const res = await GET(req({ "x-tp-real-ip": "127.0.0.1", host: "example.com" }), params);

    expect(res.status).toBe(403);
  });

  it("refuses a loopback peer that arrived through a reverse proxy", async () => {
    const { GET } = await import("../../src/app/api/mcp/[plugin]/sse/route.js");
    const res = await GET(req({
      "x-tp-peer-token": PEER,
      "x-tp-real-ip": "127.0.0.1",
      "x-tp-via-proxy": "1",
    }), params);

    expect(res.status).toBe(403);
  });

  it("lets a genuine loopback caller past the guard", async () => {
    const { GET } = await import("../../src/app/api/mcp/[plugin]/sse/route.js");
    const res = await GET(req({ "x-tp-peer-token": PEER, "x-tp-real-ip": "127.0.0.1" }), params);

    // 404 for an unregistered plugin is the guard letting it through, which is
    // what this asserts; 403 would mean the guard rejected a legitimate caller.
    expect(res.status).not.toBe(403);
  });
});
