import { afterEach, describe, expect, it, vi } from "vitest";
import { MEMORY_CONFIG } from "../../open-sse/config/runtimeConfig.js";

const dispatcherSeam = vi.hoisted(() => {
  const state = {
    instances: [],
    closeFailureByUri: new Map(),
  };

  class InjectedDispatcher {
    constructor(options) {
      this.options = options;
      this.activeWorkAborted = false;
      this.gracefulCloseRequested = false;
      this.close = vi.fn(() => {
        this.gracefulCloseRequested = true;
        const failure = state.closeFailureByUri.get(options.uri);
        if (failure?.kind === "sync") throw failure.error;
        return failure?.kind === "async" ? Promise.reject(failure.error) : Promise.resolve();
      });
      this.destroy = vi.fn(() => {
        this.activeWorkAborted = true;
        return Promise.resolve();
      });
      state.instances.push(this);
    }
  }

  return {
    InjectedDispatcher,
    state,
    reset() {
      state.instances.length = 0;
      state.closeFailureByUri.clear();
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
    expect(dispatcherSeam.state.instances[0].close).not.toHaveBeenCalled();
    expect(dispatcherSeam.state.instances[0].destroy).not.toHaveBeenCalled();
  });

  it("promotes a cache hit so overflow closes B and retains the touched A", async () => {
    const { proxyAwareFetch } = await loadHarness();
    await fillDispatcherCache(proxyAwareFetch);
    const cachedDispatchers = [...dispatcherSeam.state.instances];
    const touched = cachedDispatchers[0];
    const leastRecentlyUsed = cachedDispatchers[1];

    await fetchThrough(proxyAwareFetch, "http://proxy-0.example:8080");
    await fetchThrough(proxyAwareFetch, "http://proxy-overflow.example:8080");
    await Promise.resolve();

    expect(leastRecentlyUsed.close).toHaveBeenCalledTimes(1);
    expect(touched.close).not.toHaveBeenCalled();
    expect(touched.destroy).not.toHaveBeenCalled();
    for (const retained of [...cachedDispatchers.slice(2), touched]) {
      expect(retained.close).not.toHaveBeenCalled();
      expect(retained.destroy).not.toHaveBeenCalled();
    }
  });

  it("gracefully closes only the evicted dispatcher without aborting active work", async () => {
    const { proxyAwareFetch } = await loadHarness();
    await fillDispatcherCache(proxyAwareFetch);
    const cachedDispatchers = [...dispatcherSeam.state.instances];

    await fetchThrough(proxyAwareFetch, "http://proxy-overflow.example:8080");
    await Promise.resolve();

    expect(dispatcherSeam.state.instances).toHaveLength(MEMORY_CONFIG.proxyDispatchersMaxSize + 1);
    expect(cachedDispatchers[0].close).toHaveBeenCalledTimes(1);
    expect(cachedDispatchers[0].gracefulCloseRequested).toBe(true);
    expect(cachedDispatchers[0].activeWorkAborted).toBe(false);
    expect(cachedDispatchers[0].destroy).not.toHaveBeenCalled();
    for (const retained of cachedDispatchers.slice(1)) {
      expect(retained.close).not.toHaveBeenCalled();
      expect(retained.destroy).not.toHaveBeenCalled();
    }
    expect(dispatcherSeam.state.instances.at(-1).close).not.toHaveBeenCalled();
    expect(dispatcherSeam.state.instances.at(-1).destroy).not.toHaveBeenCalled();
  });

  it("contains a synchronous close failure and still installs the replacement", async () => {
    const { proxyAwareFetch } = await loadHarness();
    const failure = new Error("synthetic synchronous close failure");
    dispatcherSeam.state.closeFailureByUri.set(
      "http://proxy-0.example:8080",
      { kind: "sync", error: failure },
    );

    await fillDispatcherCache(proxyAwareFetch);
    const evicted = dispatcherSeam.state.instances[0];

    await expect(
      fetchThrough(proxyAwareFetch, "http://proxy-overflow.example:8080"),
    ).resolves.toMatchObject({ ok: true });

    expect(evicted.close).toHaveBeenCalledTimes(1);
    expect(evicted.destroy).not.toHaveBeenCalled();
    expect(dispatcherSeam.state.instances).toHaveLength(MEMORY_CONFIG.proxyDispatchersMaxSize + 1);
  });

  it("owns an evicted dispatcher's rejected close promise", async () => {
    const { proxyAwareFetch } = await loadHarness();
    const rejection = new Error("synthetic asynchronous close failure");
    dispatcherSeam.state.closeFailureByUri.set(
      "http://proxy-0.example:8080",
      { kind: "async", error: rejection },
    );
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);

    try {
      await fillDispatcherCache(proxyAwareFetch);
      const evicted = dispatcherSeam.state.instances[0];

      await fetchThrough(proxyAwareFetch, "http://proxy-overflow.example:8080");
      await new Promise((resolve) => setImmediate(resolve));

      expect(evicted.close).toHaveBeenCalledTimes(1);
      expect(evicted.destroy).not.toHaveBeenCalled();
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener("unhandledRejection", onUnhandled);
    }
  });
});
