// resolveRealIP caches a SUCCESSFUL lookup for five minutes but caches nothing
// when the external resolver never answers (#864). Every request to a
// MITM-bypass host — Copilot, Cursor, cloudcode, CodeWhisperer — then pays a
// fresh c-ares round of retries before falling through to native fetch, and a
// deployment that cannot reach 8.8.8.8 at all (a container with no egress to
// it) pays that on every single request rather than once.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seams = vi.hoisted(() => ({
  state: {
    dnsCalls: [],
    resolverOptions: [],
    dnsResolve: null,
  },
}));

vi.mock("dns", () => ({
  Resolver: class {
    constructor(options) {
      seams.state.resolverOptions.push(options);
    }
    setServers() {}
    resolve4(hostname, callback) {
      seams.state.dnsCalls.push(hostname);
      seams.state.dnsResolve(hostname, callback);
    }
  },
}));

const priorFetch = globalThis.fetch;
const nativeFetch = vi.fn();
globalThis.fetch = nativeFetch;
const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

const priorNoProxyPresent = Object.prototype.hasOwnProperty.call(process.env, "NO_PROXY");
const priorNoProxy = process.env.NO_PROXY;

// DNS_CACHE is module state that outlives one `it`, and the negative window is
// wall-clock, so each case gets its own sub-host. shouldBypassMitmDns matches on
// `includes`, so every one of these still takes the bypass path.
function bypassUrl(tag) {
  return `https://${tag}.proxy.individual.githubcopilot.com/chat/completions`;
}

beforeEach(() => {
  nativeFetch.mockReset();
  nativeFetch.mockResolvedValue(new Response("{}", { status: 200 }));
  seams.state.dnsCalls.length = 0;
  seams.state.resolverOptions.length = 0;
  seams.state.dnsResolve = (_hostname, callback) => callback(new Error("ENOTFOUND"));
  process.env.NO_PROXY = "*";
});

afterEach(() => {
  if (priorNoProxyPresent) process.env.NO_PROXY = priorNoProxy;
  else delete process.env.NO_PROXY;
});

afterAll(() => {
  globalThis.fetch = priorFetch;
});

describe("MITM-bypass DNS failure is cached (#864)", () => {
  it("asks the external resolver once, not once per request", async () => {
    const url = bypassUrl("once");
    await proxyAwareFetch(url, { method: "POST", body: "{}" });
    await proxyAwareFetch(url, { method: "POST", body: "{}" });
    await proxyAwareFetch(url, { method: "POST", body: "{}" });

    expect(seams.state.dnsCalls).toEqual(["once.proxy.individual.githubcopilot.com"]);
  });

  it("still serves every one of those requests through native fetch", async () => {
    const url = bypassUrl("served");
    await proxyAwareFetch(url, { method: "POST", body: "{}" });
    await proxyAwareFetch(url, { method: "POST", body: "{}" });

    expect(nativeFetch).toHaveBeenCalledTimes(2);
  });

  it("bounds the resolver so one unreachable lookup cannot stall for c-ares defaults", async () => {
    await proxyAwareFetch(bypassUrl("bounded"), { method: "POST", body: "{}" });

    const options = seams.state.resolverOptions[0];
    expect(options?.timeout).toBeGreaterThan(0);
    expect(options?.timeout).toBeLessThanOrEqual(5000);
    expect(options?.tries).toBeGreaterThanOrEqual(1);
    expect(options?.tries).toBeLessThanOrEqual(2);
  });

  it("expires the cached failure, so a resolver that comes back is retried", async () => {
    const url = bypassUrl("expiring");
    vi.useFakeTimers();
    try {
      await proxyAwareFetch(url, { method: "POST", body: "{}" });
      await proxyAwareFetch(url, { method: "POST", body: "{}" });
      expect(seams.state.dnsCalls).toHaveLength(1);

      // Past the negative-cache window the host is asked again, so an outage is
      // absorbed rather than written off permanently.
      await vi.advanceTimersByTimeAsync(61_000);
      await proxyAwareFetch(url, { method: "POST", body: "{}" });

      expect(seams.state.dnsCalls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
