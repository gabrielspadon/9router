import { afterEach, describe, expect, it, vi } from "vitest";
import { MEMORY_CONFIG } from "../../open-sse/config/runtimeConfig.js";

const dispatcherSeam = vi.hoisted(() => {
  const state = {
    instances: [],
    rejectionByUri: new Map(),
  };

  class InjectedDispatcher {
    constructor(options) {
      this.options = options;
      this.destroy = vi.fn(() => {
        const rejection = state.rejectionByUri.get(options.uri);
        return rejection ? Promise.reject(rejection) : Promise.resolve();
      });
      state.instances.push(this);
    }
  }

  return {
    InjectedDispatcher,
    state,
    reset() {
      state.instances.length = 0;
      state.rejectionByUri.clear();
    },
  };
});

vi.mock("undici", () => ({ ProxyAgent: dispatcherSeam.InjectedDispatcher }));

let restoreHarness = null;

async function loadHarness() {
  const priorFetch = globalThis.fetch;
  const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }));
  globalThis.fetch = fetchSpy;
  dispatcherSeam.reset();
  vi.resetModules();
  const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

  restoreHarness = () => {
    globalThis.fetch = priorFetch;
  };

  return { fetchSpy, proxyAwareFetch };
}

async function fetchThrough(proxyAwareFetch, proxyUrl) {
  return proxyAwareFetch(
    "https://upstream.example/v1/chat/completions",
    { method: "POST" },
    {
      connectionProxyEnabled: true,
      connectionProxyUrl: proxyUrl,
      connectionNoProxy: "",
      strictProxy: true,
    },
  );
}

async function fillDispatcherCache(proxyAwareFetch) {
  for (let index = 0; index < MEMORY_CONFIG.proxyDispatchersMaxSize; index += 1) {
    await fetchThrough(proxyAwareFetch, `http://proxy-${index}.example:8080`);
  }
}

afterEach(() => {
  restoreHarness?.();
  restoreHarness = null;
});

describe("proxy dispatcher cache eviction", () => {
  it("reuses the dispatcher for a repeated normalized proxy identity", async () => {
    const { fetchSpy, proxyAwareFetch } = await loadHarness();
    const proxyUrl = "http://proxy-reused.example:8080";

    await fetchThrough(proxyAwareFetch, proxyUrl);
    await fetchThrough(proxyAwareFetch, proxyUrl);

    expect(dispatcherSeam.state.instances).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][1].dispatcher).toBe(dispatcherSeam.state.instances[0]);
    expect(fetchSpy.mock.calls[1][1].dispatcher).toBe(dispatcherSeam.state.instances[0]);
    expect(dispatcherSeam.state.instances[0].destroy).not.toHaveBeenCalled();
  });

  it("destroys only the dispatcher removed when the cache reaches its limit", async () => {
    const { proxyAwareFetch } = await loadHarness();
    await fillDispatcherCache(proxyAwareFetch);
    const cachedDispatchers = [...dispatcherSeam.state.instances];

    await fetchThrough(proxyAwareFetch, "http://proxy-overflow.example:8080");
    await Promise.resolve();

    expect(dispatcherSeam.state.instances).toHaveLength(MEMORY_CONFIG.proxyDispatchersMaxSize + 1);
    expect(cachedDispatchers[0].destroy).toHaveBeenCalledTimes(1);
    for (const retained of cachedDispatchers.slice(1)) {
      expect(retained.destroy).not.toHaveBeenCalled();
    }
    expect(dispatcherSeam.state.instances.at(-1).destroy).not.toHaveBeenCalled();
  });

  it("owns an evicted dispatcher's rejected destroy promise", async () => {
    const { proxyAwareFetch } = await loadHarness();
    const rejection = new Error("synthetic dispatcher destroy failure");
    dispatcherSeam.state.rejectionByUri.set("http://proxy-0.example:8080", rejection);
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      await fillDispatcherCache(proxyAwareFetch);
      const evicted = dispatcherSeam.state.instances[0];

      await fetchThrough(proxyAwareFetch, "http://proxy-overflow.example:8080");
      await new Promise((resolve) => setImmediate(resolve));

      expect(evicted.destroy).toHaveBeenCalledTimes(1);
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener("unhandledRejection", onUnhandled);
    }
  });
});
