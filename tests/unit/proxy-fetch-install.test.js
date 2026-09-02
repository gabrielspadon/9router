import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROXY_ENV_KEYS = [
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
];
const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
const originalProxyEnv = Object.fromEntries(PROXY_ENV_KEYS.map((key) => [key, process.env[key]]));

function restoreProxyEnv() {
  for (const key of PROXY_ENV_KEYS) {
    const value = originalProxyEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function useSyntheticHttpsProxy() {
  for (const key of PROXY_ENV_KEYS) delete process.env[key];
  process.env.HTTPS_PROXY = "http://proxy.invalid:3128";
}

function requestRecord(fetchMock) {
  const [[url, init]] = fetchMock.mock.calls;
  return {
    url: String(url),
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal instanceof AbortSignal,
    extraInitKeys: Object.keys(init)
      .filter((key) => !["method", "headers", "body", "signal"].includes(key))
      .sort(),
  };
}

function mockProxyModule(installer) {
  const proxyAwareFetch = vi.fn();
  vi.doMock("../../open-sse/utils/proxyFetch.js", () => ({
    default: proxyAwareFetch,
    installGlobalProxyFetch: installer,
    isLoopbackTarget: vi.fn(() => false),
    proxyAwareFetch,
  }));
  vi.doMock("../../open-sse/utils/kimchiUserAgent.js", () => ({
    getKimchiUserAgent: vi.fn(() => "kimchi/test"),
    updateKimchiUserAgent: vi.fn(async () => "kimchi/test"),
  }));
}

beforeEach(() => {
  vi.resetModules();
  restoreProxyEnv();
  Object.defineProperty(globalThis, "fetch", originalFetchDescriptor);
});

afterEach(() => {
  vi.doUnmock("../../open-sse/utils/proxyFetch.js");
  vi.doUnmock("../../open-sse/utils/kimchiUserAgent.js");
  vi.resetModules();
  vi.restoreAllMocks();
  restoreProxyEnv();
  Object.defineProperty(globalThis, "fetch", originalFetchDescriptor);
});

describe("proxy fetch installation boundaries", () => {
  it("keeps global fetch identity when the Ollama handler is imported in a fresh module graph", async () => {
    const directFetch = vi.fn();
    globalThis.fetch = directFetch;

    await import("../../open-sse/handlers/fetch/index.js");

    expect(globalThis.fetch).toBe(directFetch);
  });

  it.each([
    {
      name: "Jina",
      params: {
        url: "https://example.com/article",
        format: "markdown",
        provider: "jina-reader",
        providerConfig: { timeoutMs: 30000 },
        credentials: { apiKey: "jina-test-key" },
      },
      response: () => new Response("Title: Example\n\nMarkdown Content:\nHello"),
      request: {
        url: "https://r.jina.ai/",
        method: "POST",
        headers: {
          "content-type": "application/json",
          // The requested return format travels on this header, the way
          // Firecrawl's travels in its body below (#2239).
          "x-return-format": "markdown",
          authorization: "Bearer jina-test-key",
        },
        body: '{"url":"https://example.com/article"}',
        signal: true,
        extraInitKeys: [],
      },
    },
    {
      name: "Firecrawl",
      params: {
        url: "https://example.com/article",
        format: "markdown",
        provider: "firecrawl",
        providerConfig: { timeoutMs: 30000 },
        credentials: { apiKey: "firecrawl-test-key" },
      },
      response: () => new Response('{"data":{"markdown":"Hello"}}', {
        headers: { "Content-Type": "application/json" },
      }),
      request: {
        url: "https://api.firecrawl.dev/v1/scrape",
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer firecrawl-test-key",
        },
        body: '{"url":"https://example.com/article","formats":["markdown"]}',
        signal: true,
        extraInitKeys: [],
      },
    },
  ])("keeps the legacy $name request byte-identical and direct under HTTPS_PROXY", async ({ params, response, request }) => {
    useSyntheticHttpsProxy();
    const directFetch = vi.fn().mockImplementation(async () => response());
    globalThis.fetch = directFetch;
    const { handleFetchCore } = await import("../../open-sse/handlers/fetch/index.js");

    const result = await handleFetchCore(params);

    expect(result.success).toBe(true);
    expect(directFetch).toHaveBeenCalledTimes(1);
    expect(requestRecord(directFetch)).toEqual(request);
  });

  it("installs the global proxy transport once only when explicitly requested", async () => {
    const directFetch = vi.fn();
    let currentFetch = directFetch;
    const setFetch = vi.fn((value) => {
      currentFetch = value;
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      get: () => currentFetch,
      set: setFetch,
    });

    const { installGlobalProxyFetch } = await import("../../open-sse/utils/proxyFetch.js");

    expect(setFetch).not.toHaveBeenCalled();
    expect(typeof installGlobalProxyFetch).toBe("function");
    installGlobalProxyFetch();
    const installedFetch = globalThis.fetch;
    installGlobalProxyFetch();
    expect(installedFetch).not.toBe(directFetch);
    expect(globalThis.fetch).toBe(installedFetch);
    expect(setFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["open-sse barrel", () => import("../../open-sse/index.js")],
    ["OAuth provider barrel", () => import("../../src/lib/oauth/providers/index.js")],
  ])("explicitly installs global proxy fetch once from the %s", async (_name, importEntrypoint) => {
    const installer = vi.fn();
    mockProxyModule(installer);

    await importEntrypoint();

    expect(installer).toHaveBeenCalledTimes(1);
  }, 30_000);

  it("keeps named proxyAwareFetch functional without installing it globally", async () => {
    useSyntheticHttpsProxy();
    process.env.NO_PROXY = "*";
    const response = new Response("ok");
    const directFetch = vi.fn().mockResolvedValue(response);
    globalThis.fetch = directFetch;
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
    const init = { method: "POST", body: "payload" };

    const result = await proxyAwareFetch("https://example.com/direct", init);

    expect(result).toBe(response);
    expect(directFetch).toHaveBeenCalledTimes(1);
    expect(directFetch.mock.calls[0][0]).toBe("https://example.com/direct");
    expect(directFetch.mock.calls[0][1]).toMatchObject({ method: "POST", body: "payload" });
    expect(directFetch.mock.calls[0][1].dispatcher.constructor.name).toBe("Agent");
  });
});
