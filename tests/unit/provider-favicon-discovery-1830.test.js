// Issue #1830: show a custom provider's own favicon instead of initials. The
// report's central constraint is SSRF protection before fetching a
// user-provided URL. The stronger answer is not to accept one: the route takes
// a node id, so the only reachable origins are base URLs an operator already
// registered and the gateway already sends API keys to. assertPublicUrl still
// runs on every candidate, because a node's base URL is operator input.
import { describe, expect, it, vi, beforeEach } from "vitest";

const node = { id: "n1", baseUrl: "https://ai.sumopod.com/v1/" };
let nodes = { n1: node };
const fetchCalls = [];
let responder = () => null;

vi.mock("@/lib/db/repos/nodesRepo.js", () => ({
  getProviderNodeById: async (id) => nodes[id] || null,
}));
vi.mock("@/shared/utils/ssrfGuard", () => ({
  assertPublicUrl: (url) => {
    if (/localhost|127\.0\.0\.1|169\.254|10\./.test(url)) throw new Error("ERR_SSRF_BLOCKED");
  },
  fetchPublicUrl: async (url) => {
    fetchCalls.push(url);
    const r = responder(url);
    if (!r) return { ok: false, status: 404, headers: new Map() };
    return {
      ok: true,
      status: 200,
      headers: { get: (k) => r.headers[k.toLowerCase()] ?? null },
      arrayBuffer: async () => r.body,
    };
  },
}));

const { GET, faviconCandidates } = await import("@/app/api/provider-nodes/favicon/route.js");
const req = (qs) => ({ url: `http://localhost/api/provider-nodes/favicon?${qs}` });
const png = (bytes = 40) => ({ headers: { "content-type": "image/png" }, body: new Uint8Array(bytes).buffer });

// The route caches by base URL by design, so each case gets its own origin
// rather than reaching into the cache to clear it.
let originSeq = 0;
beforeEach(() => {
  originSeq += 1;
  nodes = { n1: { ...node, baseUrl: `https://p${originSeq}.sumopod.com/v1/` } };
  fetchCalls.length = 0;
  responder = () => null;
});

describe("candidate order (#1830)", () => {
  it("tries endpoint-adjacent, then the origin root, then the registrable domain", () => {
    expect(faviconCandidates("https://ai.sumopod.com/v1/")).toEqual([
      "https://ai.sumopod.com/v1/favicon.ico",
      "https://ai.sumopod.com/favicon.ico",
      "https://sumopod.com/favicon.ico",
    ]);
  });

  it("does not repeat the origin root when the base URL already is it", () => {
    expect(faviconCandidates("https://example.com/")).toEqual(["https://example.com/favicon.ico"]);
  });

  it("never walks up from an IP literal, where a label up means nothing", () => {
    expect(faviconCandidates("https://203.0.113.9/v1/")).toEqual([
      "https://203.0.113.9/v1/favicon.ico",
      "https://203.0.113.9/favicon.ico",
    ]);
  });

  it("refuses a non-http scheme and a malformed base outright", () => {
    expect(faviconCandidates("file:///etc/passwd")).toEqual([]);
    expect(faviconCandidates("not a url")).toEqual([]);
  });
});

describe("what the route will fetch (#1830)", () => {
  it("takes a node id, never a URL, so it is not a fetch proxy", async () => {
    const res = await GET(req("url=https://evil.example/x"));
    expect(res.status).toBe(400);
    expect(fetchCalls).toHaveLength(0);
  });

  it("404s an unknown node instead of guessing an origin", async () => {
    const res = await GET(req("nodeId=missing"));
    expect(res.status).toBe(404);
    expect(fetchCalls).toHaveLength(0);
  });

  it("still runs the SSRF guard, since a node base URL is operator input", async () => {
    nodes.n1.baseUrl = "http://localhost:9999/v1/";
    const res = await GET(req("nodeId=n1"));
    expect(res.status).toBe(204);
  });
});

describe("what it accepts back (#1830)", () => {
  it("returns the first candidate that answers, as a data URI", async () => {
    const root = `${new URL(nodes.n1.baseUrl).origin}/favicon.ico`;
    responder = (url) => (url === root ? png() : null);
    const body = await (await GET(req("nodeId=n1"))).json();
    expect(body.icon).toMatch(/^data:image\/png;base64,/);
    expect(body.source).toBe(root);
  });

  it("refuses a body that is not an image type", async () => {
    responder = () => ({ headers: { "content-type": "text/html" }, body: new Uint8Array(10).buffer });
    expect((await GET(req("nodeId=n1"))).status).toBe(204);
  });

  it("refuses a body over the size cap, declared or actual", async () => {
    responder = () => ({ headers: { "content-type": "image/png", "content-length": "999999" }, body: new Uint8Array(10).buffer });
    expect((await GET(req("nodeId=n1"))).status).toBe(204);
    responder = () => png(200 * 1024);
    nodes.n1.baseUrl = `https://oversize${originSeq}.example.com/v1/`;
    expect((await GET(req("nodeId=n1"))).status).toBe(204);
  });

  it("204s when nothing answers, which is the caller's cue to use initials", async () => {
    expect((await GET(req("nodeId=n1"))).status).toBe(204);
  });
});

describe("caching (#1830)", () => {
  it("does not re-probe a hit", async () => {
    nodes.n1.baseUrl = "https://cached-hit.example.com/v1/";
    responder = () => png();
    await GET(req("nodeId=n1"));
    const after = fetchCalls.length;
    await GET(req("nodeId=n1"));
    expect(fetchCalls).toHaveLength(after);
  });

  it("does not re-probe a miss either, which is the expensive case", async () => {
    nodes.n1.baseUrl = "https://cached-miss.example.com/v1/";
    await GET(req("nodeId=n1"));
    const after = fetchCalls.length;
    expect(after).toBeGreaterThan(0);
    await GET(req("nodeId=n1"));
    expect(fetchCalls).toHaveLength(after);
  });
});
