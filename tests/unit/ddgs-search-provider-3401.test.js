// Issue #3401 — DDGS (deedy5/ddgs) as a self-hosted alternative to SearXNG.
// Contract derived from ddgs/api_server/api.py: POST /search/text and
// /search/news take {query, region, safesearch, timelimit, max_results, page,
// backend} and answer {results: [...]}. text() rows carry {title, href, body};
// news() rows carry {date, title, body, url, image, source}.
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSearchRequest } from "../../open-sse/handlers/search/callers.js";
import { normalizeSearchResponse } from "../../open-sse/handlers/search/normalizers.js";

const CONFIG = { id: "ddgs", baseUrl: "http://localhost:4479", method: "POST" };

function build(params) {
  const { url, init } = buildSearchRequest(CONFIG, {
    query: "ocean acidification",
    searchType: "web",
    maxResults: 5,
    ...params,
  });
  return { url, init, body: JSON.parse(init.body) };
}

const originalDdgsUrl = process.env.DDGS_URL;
afterEach(() => {
  if (originalDdgsUrl === undefined) delete process.env.DDGS_URL;
  else process.env.DDGS_URL = originalDdgsUrl;
  vi.resetModules();
});

describe("DDGS request builder", () => {
  it("posts JSON to /search/text for a web search", () => {
    const { url, init, body } = build({});
    expect(url).toBe("http://localhost:4479/search/text");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(body).toEqual({ query: "ocean acidification", max_results: 5 });
  });

  it("posts to /search/news for a news search", () => {
    expect(build({ searchType: "news" }).url).toBe("http://localhost:4479/search/news");
  });

  it("sends no auth header (the ddgs api server has none)", () => {
    expect(build({ token: "should-be-ignored" }).init.headers).toEqual({
      "Content-Type": "application/json",
    });
  });

  it("joins country and language into the DDGS region token", () => {
    expect(build({ country: "US", language: "EN" }).body.region).toBe("us-en");
  });

  it("omits region unless both halves are present", () => {
    expect(build({ language: "en" }).body.region).toBeUndefined();
    expect(build({ country: "US" }).body.region).toBeUndefined();
  });

  it("maps time_range onto the single-letter timelimit", () => {
    expect(build({ timeRange: "day" }).body.timelimit).toBe("d");
    expect(build({ timeRange: "week" }).body.timelimit).toBe("w");
    expect(build({ timeRange: "month" }).body.timelimit).toBe("m");
    expect(build({ timeRange: "year" }).body.timelimit).toBe("y");
    expect(build({ timeRange: "any" }).body.timelimit).toBeUndefined();
  });

  it("drops the year timelimit on news, which DDGS documents as d/w/m only", () => {
    expect(build({ searchType: "news", timeRange: "year" }).body.timelimit).toBeUndefined();
    expect(build({ searchType: "news", timeRange: "month" }).body.timelimit).toBe("m");
  });

  it("turns offset into a 1-indexed page", () => {
    expect(build({ offset: 10 }).body.page).toBe(3);
    expect(build({ offset: 0 }).body.page).toBeUndefined();
  });

  it("passes a chosen backend engine through and omits it otherwise", () => {
    expect(build({ providerOptions: { backend: "brave,mojeek" } }).body.backend).toBe("brave,mojeek");
    expect(build({}).body.backend).toBeUndefined();
  });

  it("reads safesearch and backend from providerSpecificData too", () => {
    const { body } = build({ providerSpecificData: { safesearch: "off", backend: "google" } });
    expect(body.safesearch).toBe("off");
    expect(body.backend).toBe("google");
  });

  it("does not double the path when the base URL already names an endpoint", () => {
    expect(buildSearchRequest({ id: "ddgs", baseUrl: "http://ddgs:4479/search/text" }, {
      query: "q", searchType: "web", maxResults: 5,
    }).url).toBe("http://ddgs:4479/search/text");
    expect(buildSearchRequest({ id: "ddgs", baseUrl: "http://ddgs:4479/search" }, {
      query: "q", searchType: "news", maxResults: 5,
    }).url).toBe("http://ddgs:4479/search/news");
  });
});

describe("DDGS response normalizer", () => {
  it("maps text() rows, whose link field is href", () => {
    const { results, totalResults } = normalizeSearchResponse("ddgs", {
      results: [
        { title: "Ocean acidification", href: "https://www.example.org/oa?ref=1", body: "Carbonate chemistry." },
      ],
    }, "ocean acidification", "web");

    expect(totalResults).toBe(1);
    expect(results[0]).toMatchObject({
      title: "Ocean acidification",
      url: "https://www.example.org/oa?ref=1",
      display_url: "example.org/oa",
      snippet: "Carbonate chemistry.",
      position: 1,
    });
    expect(results[0].citation.provider).toBe("ddgs");
  });

  it("maps news() rows, whose link field is url, plus date/image/source", () => {
    const { results } = normalizeSearchResponse("ddgs", {
      results: [
        {
          date: "2024-07-03T16:25:22+00:00",
          title: "Sun endorses Labour",
          body: "A dramatic move.",
          url: "https://news.example.com/a",
          image: "https://img.example.com/a.jpg",
          source: "Bloomberg",
        },
      ],
    }, "sun", "news");

    expect(results[0].url).toBe("https://news.example.com/a");
    expect(results[0].published_at).toBe("2024-07-03T16:25:22+00:00");
    expect(results[0].metadata.source_type).toBe("Bloomberg");
    expect(results[0].metadata.image_url).toBe("https://img.example.com/a.jpg");
  });

  it("returns an empty set rather than throwing on a malformed payload", () => {
    expect(normalizeSearchResponse("ddgs", {}, "q", "web")).toEqual({ results: [], totalResults: 0 });
    expect(normalizeSearchResponse("ddgs", { results: "nope" }, "q", "web")).toEqual({
      results: [],
      totalResults: 0,
    });
  });
});

describe("DDGS provider entry", () => {
  async function loadProvider(url) {
    if (url === undefined) delete process.env.DDGS_URL;
    else process.env.DDGS_URL = url;
    vi.resetModules();
    return (await import("../../open-sse/providers/registry/ddgs.js")).default;
  }

  it("is a credential-free webSearch provider, like SearXNG", async () => {
    const provider = await loadProvider(undefined);
    expect(provider.id).toBe("ddgs");
    expect(provider.serviceKinds).toContain("webSearch");
    expect(provider.authType).toBe("none");
    expect(provider.noAuth).toBe(true);
    expect(provider.searchConfig.searchTypes).toEqual(["web", "news"]);
  });

  it("defaults to the loopback ddgs api port and honours DDGS_URL", async () => {
    expect((await loadProvider(undefined)).searchConfig.baseUrl).toBe("http://localhost:4479");
    expect((await loadProvider("http://ddgs:4479")).searchConfig.baseUrl).toBe("http://ddgs:4479");
  });

  it("has a builder and a normalizer wired for its id", () => {
    expect(build({}).url).toContain("/search/text");
    expect(normalizeSearchResponse("ddgs", { results: [] }, "q", "web").totalResults).toBe(0);
  });
});
