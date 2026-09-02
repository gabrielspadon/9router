// #1231 reports the SearXNG endpoint as hardcoded. It is not: SEARXNG_URL is
// the config surface (open-sse/config/runtimeConfig.js), the registry entry
// reads it, and the request builder sends the search there. What the issue asks
// for beyond that — a base-URL field in the dashboard — is a different change:
// a client-supplied baseUrl goes through assertPublicUrl, which rejects the
// loopback and LAN hosts every self-hosted SearXNG runs on. That boundary is
// asserted here too, so "add the field" cannot be done by accident.
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSearchRequest, resolveBaseUrl } from "../../open-sse/handlers/search/callers.js";

const originalSearxngUrl = process.env.SEARXNG_URL;

afterEach(() => {
  if (originalSearxngUrl === undefined) delete process.env.SEARXNG_URL;
  else process.env.SEARXNG_URL = originalSearxngUrl;
  vi.resetModules();
});

async function searxngConfig(url) {
  if (url === undefined) delete process.env.SEARXNG_URL;
  else process.env.SEARXNG_URL = url;
  vi.resetModules();
  const provider = (await import("../../open-sse/providers/registry/searxng.js")).default;
  return { id: provider.id, ...provider.searchConfig };
}

function build(config, params = {}) {
  return buildSearchRequest(config, {
    query: "ocean acidification",
    searchType: "web",
    maxResults: 5,
    ...params,
  });
}

describe("SearXNG endpoint configuration (#1231)", () => {
  it("sends the search to the host SEARXNG_URL names, not to the default", async () => {
    const config = await searxngConfig("http://searxng:8080/search");
    const { url } = build(config);

    expect(url.startsWith("http://searxng:8080/search?")).toBe(true);
    expect(url).not.toContain("localhost:8888");
  });

  it("appends /search when the configured value is an origin only", async () => {
    const config = await searxngConfig("http://searxng:8080");
    const { url } = build(config);

    expect(url.startsWith("http://searxng:8080/search?")).toBe(true);
  });

  it("falls back to the loopback default when nothing is configured", async () => {
    const config = await searxngConfig(undefined);
    const { url } = build(config);

    expect(url.startsWith("http://localhost:8888/search?")).toBe(true);
  });

  it("a client-supplied override is still refused for an internal host", async () => {
    // This is why the requested dashboard field is a separate decision rather
    // than an oversight: the value a self-hosted user would type is exactly
    // what the SSRF guard exists to reject.
    const config = await searxngConfig("http://searxng:8080/search");

    for (const baseUrl of ["http://127.0.0.1:8888/search", "http://169.254.169.254/", "http://10.0.0.5:8888"]) {
      expect(() => resolveBaseUrl(config, { providerOptions: { baseUrl } }), baseUrl).toThrow();
    }
  });
});
