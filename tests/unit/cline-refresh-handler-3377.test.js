import { describe, expect, it, vi, beforeEach } from "vitest";

// Issues #3377 and #3230. Cline's refresh endpoint takes a JSON body, not the
// form-encoded grant_type/refresh_token/client_id the generic path sends, and
// answers the generic shape with a 400. executors/default.js knew that; the
// background refresh map did not list cline at all, so a scheduled refresh
// failed silently while an on-request one worked.

const calls = [];
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: async (url, options, proxyOptions) => {
    calls.push({ url: String(url), body: options?.body, headers: options?.headers, proxyOptions });
    return new Response(JSON.stringify({
      data: { accessToken: "tok", refreshToken: "next", expiresAt: new Date(Date.now() + 3600e3).toISOString() },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  },
}));

beforeEach(() => { calls.length = 0; });

describe("Cline refresh contract (#3377)", () => {
  it("is reachable from the background refresh map for cline and clinepass", async () => {
    const { getAccessToken } = await import("../../open-sse/services/tokenRefresh.js");
    expect(typeof getAccessToken).toBe("function");

    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../open-sse/services/tokenRefresh.js", import.meta.url), "utf8"));
    expect(src).toMatch(/^\s*cline: /m);
    expect(src).toMatch(/^\s*clinepass: /m);
  });

  it("sends the JSON body the endpoint expects, not a form body", async () => {
    const { refreshClineToken } = await import("../../open-sse/services/tokenRefresh/providers.js");
    await refreshClineToken("rt-1", null, null);

    expect(calls).toHaveLength(1);
    expect(calls[0].headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0].body)).toEqual({
      refreshToken: "rt-1", grantType: "refresh_token", clientType: "extension",
    });
    expect(calls[0].body).not.toContain("grant_type=");
  });

  it("prefixes the access token with workos: when the upstream omits it", async () => {
    const { refreshClineToken } = await import("../../open-sse/services/tokenRefresh/providers.js");
    const out = await refreshClineToken("rt-2", null, null);

    expect(out.accessToken).toBe("workos:tok");
    expect(out.refreshToken).toBe("next");
    expect(out.expiresIn).toBeGreaterThan(0);
  });

  it("forwards proxy options so a pinned connection stays pinned", async () => {
    const { refreshClineToken } = await import("../../open-sse/services/tokenRefresh/providers.js");
    const opts = { connectionProxyEnabled: true, connectionProxyUrl: "http://p:3128", strictProxy: true };
    await refreshClineToken("rt-3", opts, null);

    expect(calls[0].proxyOptions).toMatchObject(opts);
  });

  it("keeps the executor and the scheduler on one implementation", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../../open-sse/executors/default.js", import.meta.url), "utf8");
    // A second copy in the executor is how the two drifted apart in the first place.
    expect(src).toContain("return refreshClineToken(refreshToken, proxyOptions);");
    expect(src).not.toContain('grantType: "refresh_token"');
  });
});
