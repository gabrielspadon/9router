import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { resolveEffectiveProxyRoute } from "../../open-sse/utils/proxyFetch.js";
import { connectHttp2 } from "../../open-sse/utils/http2Connect.js";

const TARGET = "https://agent.api5.cursor.sh/agent.v1.AgentService/Run";

function resolverDeps(envProxyUrl = "http://env-proxy.test:8080") {
  return { getEnvProxyUrl: vi.fn(() => envProxyUrl) };
}

describe("Cursor HTTP/2 effective egress route", () => {
  it("selects a connection proxy before environment and redacts its cache identity", () => {
    const deps = resolverDeps();

    const route = resolveEffectiveProxyRoute(TARGET, {
      resolutionKind: "selected-proxy",
      connectionProxyEnabled: true,
      connectionProxyUrl: "https://name:secret@proxy.test:8443",
      strictProxy: true,
    }, deps);

    expect(route).toMatchObject({ kind: "proxy", strictProxy: true });
    expect(route.cacheIdentity).toMatch(/^proxy:[a-f0-9]{64}$/);
    expect(route.cacheIdentity).not.toContain("secret");
    expect(route.cacheIdentity).not.toContain("proxy.test");
    expect(deps.getEnvProxyUrl).not.toHaveBeenCalled();
  });

  it("treats matching selected connectionNoProxy as intentional direct egress", () => {
    const deps = resolverDeps();

    const route = resolveEffectiveProxyRoute(TARGET, {
      resolutionKind: "selected-proxy",
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.test:8080",
      connectionNoProxy: ".cursor.sh",
      strictProxy: true,
    }, deps);

    expect(route).toEqual({ kind: "direct", strictProxy: false, cacheIdentity: "direct" });
    expect(deps.getEnvProxyUrl).not.toHaveBeenCalled();
  });

  it.each(["connection-proxy-direct", "pool-none"])("keeps %s direct without environment resolution", (reason) => {
    const deps = resolverDeps();

    expect(resolveEffectiveProxyRoute(TARGET, {
      resolutionKind: "intentional-direct",
      reason,
    }, deps)).toEqual({ kind: "direct", strictProxy: false, cacheIdentity: "direct" });
    expect(deps.getEnvProxyUrl).not.toHaveBeenCalled();
  });

  it("rejects a required-unavailable persisted selection before environment resolution", () => {
    const deps = resolverDeps();

    expect(resolveEffectiveProxyRoute(TARGET, {
      resolutionKind: "required-unavailable",
      strictProxy: true,
      reason: "selected-pool-missing",
    }, deps)).toEqual({
      kind: "required-unavailable",
      strictProxy: true,
      reason: "selected-pool-missing",
      cacheIdentity: null,
    });
    expect(deps.getEnvProxyUrl).not.toHaveBeenCalled();
  });

  it.each([
    [true, "smtp://proxy.test:25"],
    [false, "smtp://proxy.test:25"],
    [true, ""],
  ])("rejects malformed selected proxy strict=%s without environment fallback", (strictProxy, connectionProxyUrl) => {
    const deps = resolverDeps();

    expect(resolveEffectiveProxyRoute(TARGET, {
      resolutionKind: "selected-proxy",
      connectionProxyEnabled: true,
      connectionProxyUrl,
      strictProxy,
    }, deps)).toMatchObject({
      kind: "required-unavailable",
      strictProxy,
      reason: "selected-proxy-invalid",
      cacheIdentity: null,
    });
    expect(deps.getEnvProxyUrl).not.toHaveBeenCalled();
  });

  it("rejects a selected relay before proxy or environment transport selection", () => {
    const deps = resolverDeps();

    expect(resolveEffectiveProxyRoute(TARGET, {
      resolutionKind: "selected-proxy",
      vercelRelayUrl: "https://relay.test/forward",
      strictProxy: true,
    }, deps)).toEqual({ kind: "relay", strictProxy: true, cacheIdentity: null });
    expect(deps.getEnvProxyUrl).not.toHaveBeenCalled();
  });

  it("uses environment policy only for an unselected connection", () => {
    const deps = resolverDeps("127.0.0.1:8888");

    expect(resolveEffectiveProxyRoute(TARGET, { resolutionKind: "unselected" }, deps)).toMatchObject({
      kind: "proxy",
      strictProxy: false,
      proxyUrl: "http://127.0.0.1:8888",
    });
    expect(deps.getEnvProxyUrl).toHaveBeenCalledWith(TARGET);
  });

  it("makes zero generic fetch calls for required-unavailable provenance", async () => {
    const originalFetch = globalThis.fetch;
    const fetch = vi.fn();
    globalThis.fetch = fetch;
    vi.resetModules();
    const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");

    try {
      await expect(proxyAwareFetch(TARGET, {}, {
        resolutionKind: "required-unavailable",
        strictProxy: true,
        reason: "selected-pool-missing",
      })).rejects.toMatchObject({ code: "required_proxy_unavailable" });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function socket() {
  const value = new EventEmitter();
  value.destroy = vi.fn((error) => {
    if (!value.destroyed) {
      value.destroyed = true;
      value.emit("close", error);
    }
  });
  value.write = vi.fn();
  value.unshift = vi.fn();
  return value;
}

function session({ autoConnect = true } = {}) {
  const value = new EventEmitter();
  value.close = vi.fn(() => value.emit("close"));
  value.destroy = vi.fn((error) => value.emit("close", error));
  if (autoConnect) queueMicrotask(() => value.emit("connect"));
  return value;
}

function fakePrimitives({
  connectResponse = ["HTTP/1.1 200 Connection established\r\n\r\n"],
  autoNetConnect = true,
  autoTlsConnect = true,
  autoHttp2Connect = true,
} = {}) {
  const netSocket = socket();
  const tlsSockets = [];
  const sessions = [];
  const socksSocket = socket();
  const socksConnect = vi.fn(async () => socksSocket);
  const primitives = {
    netConnect: vi.fn(() => {
      if (autoNetConnect) queueMicrotask(() => netSocket.emit("connect"));
      return netSocket;
    }),
    tlsConnect: vi.fn(() => {
      const value = socket();
      tlsSockets.push(value);
      value.write.mockImplementation(() => {
        for (const chunk of connectResponse) queueMicrotask(() => value.emit("data", Buffer.from(chunk)));
        return true;
      });
      if (autoTlsConnect) queueMicrotask(() => value.emit("secureConnect"));
      return value;
    }),
    http2Connect: vi.fn((_origin, options = {}) => {
      const value = session({ autoConnect: autoHttp2Connect });
      value.connection = options.createConnection?.();
      sessions.push(value);
      return value;
    }),
    createSocksAgent: vi.fn(() => ({ connect: socksConnect })),
  };
  netSocket.write.mockImplementation(() => {
    for (const chunk of connectResponse) queueMicrotask(() => netSocket.emit("data", Buffer.from(chunk)));
    return true;
  });
  return { primitives, netSocket, tlsSockets, sessions, socksSocket, socksConnect };
}

function proxyRoute(proxyUrl, strictProxy = true) {
  return { kind: "proxy", proxyUrl, strictProxy, cacheIdentity: "proxy:test" };
}

function rejectionWithin(promise) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("connection did not reject before readiness")), 75);
    Promise.resolve(promise).then(
      () => {
        clearTimeout(timer);
        reject(new Error("connection resolved before readiness"));
      },
      error => {
        clearTimeout(timer);
        resolve(error);
      },
    );
  });
}

describe("Cursor HTTP/2 tunnel SessionLease", () => {
  it("opens a direct session and closes it only once", async () => {
    const fake = fakePrimitives();

    const lease = await connectHttp2(TARGET, {
      route: { kind: "direct", strictProxy: false, cacheIdentity: "direct" },
      primitives: fake.primitives,
    });

    expect(fake.primitives.netConnect).not.toHaveBeenCalled();
    expect(fake.primitives.tlsConnect).not.toHaveBeenCalled();
    expect(fake.primitives.http2Connect).toHaveBeenCalledWith("https://agent.api5.cursor.sh", {});
    expect(lease.effectiveRoute).toEqual({ kind: "direct", strictProxy: false, cacheIdentity: "direct" });
    lease.close();
    lease.close();
    expect(fake.sessions[0].close).toHaveBeenCalledTimes(1);
  });

  it("rejects and cleans a direct H2 session that closes before readiness", async () => {
    const fake = fakePrimitives({ autoHttp2Connect: false });
    const pending = connectHttp2(TARGET, {
      route: { kind: "direct", strictProxy: false, cacheIdentity: "direct" },
      primitives: fake.primitives,
    });
    queueMicrotask(() => fake.sessions[0].emit("close"));

    await expect(rejectionWithin(pending)).resolves.toMatchObject({ code: "http2_connection_closed" });
    expect(fake.sessions[0].destroy).toHaveBeenCalledTimes(1);
  });

  it.each(["http:", "https:"])("uses verified %s CONNECT before target TLS", async (scheme) => {
    const fake = fakePrimitives();

    const lease = await connectHttp2(TARGET, {
      route: proxyRoute(`${scheme}//name:secret@proxy.test:8443`),
      primitives: fake.primitives,
    });

    expect(fake.primitives.netConnect).toHaveBeenCalledTimes(scheme === "http:" ? 1 : 0);
    expect(fake.primitives.tlsConnect).toHaveBeenCalledTimes(scheme === "http:" ? 1 : 2);
    if (scheme === "https:") {
      expect(fake.primitives.tlsConnect).toHaveBeenNthCalledWith(1, expect.objectContaining({
        host: "proxy.test",
        port: 8443,
        servername: "proxy.test",
      }));
      expect(fake.primitives.tlsConnect.mock.calls[0][0]).not.toHaveProperty("rejectUnauthorized", false);
    }
    const connectSocket = scheme === "http:" ? fake.netSocket : fake.tlsSockets[0];
    expect(connectSocket.write).toHaveBeenCalledWith(expect.stringContaining("CONNECT agent.api5.cursor.sh:443 HTTP/1.1"));
    expect(connectSocket.write).toHaveBeenCalledWith(expect.stringContaining("Proxy-Authorization: Basic bmFtZTpzZWNyZXQ="));
    expect(connectSocket.write).not.toHaveBeenCalledWith(expect.stringContaining("secret@"));
    expect(lease.effectiveRoute).toMatchObject({ kind: "proxy", strictProxy: true });
    expect(fake.primitives.http2Connect).toHaveBeenCalledWith("https://agent.api5.cursor.sh", expect.objectContaining({
      createConnection: expect.any(Function),
    }));
    expect(fake.sessions[0].connection).toBe(fake.tlsSockets.at(-1));
  });

  it("preserves bytes after a split CONNECT header", async () => {
    const fake = fakePrimitives({ connectResponse: [
      "HTTP/1.1 200 Connection established\r\nProxy-Agent: fake\r\n",
      "\r\nprebuffered",
    ] });

    await connectHttp2(TARGET, {
      route: proxyRoute("http://proxy.test:8080"),
      primitives: fake.primitives,
    });

    expect(fake.netSocket.unshift).toHaveBeenCalledWith(Buffer.from("prebuffered"));
  });

  it.each(["socks:", "socks4:", "socks4a:", "socks5:", "socks5h:"])("uses socks-proxy-agent for %s routes", async (scheme) => {
    const fake = fakePrimitives();

    await connectHttp2(TARGET, {
      route: proxyRoute(`${scheme}//proxy.test:1080`),
      primitives: fake.primitives,
    });

    expect(fake.primitives.createSocksAgent).toHaveBeenCalledWith(`${scheme}//proxy.test:1080`);
    expect(fake.socksConnect).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      host: "agent.api5.cursor.sh",
      port: 443,
      secureEndpoint: false,
    }));
    expect(fake.primitives.tlsConnect).toHaveBeenCalledWith(expect.objectContaining({
      socket: fake.socksSocket,
      servername: "agent.api5.cursor.sh",
      ALPNProtocols: ["h2"],
    }));
  });

  it("rejects relay and unavailable routes without constructing a transport", async () => {
    const fake = fakePrimitives();

    await expect(connectHttp2(TARGET, {
      route: { kind: "relay", strictProxy: true, cacheIdentity: null },
      primitives: fake.primitives,
    })).rejects.toMatchObject({ code: "unsupported_proxy_route" });
    await expect(connectHttp2(TARGET, {
      route: { kind: "required-unavailable", strictProxy: true, reason: "pool-missing", cacheIdentity: null },
      primitives: fake.primitives,
    })).rejects.toMatchObject({ code: "required_proxy_unavailable" });

    expect(fake.primitives.netConnect).not.toHaveBeenCalled();
    expect(fake.primitives.tlsConnect).not.toHaveBeenCalled();
    expect(fake.primitives.createSocksAgent).not.toHaveBeenCalled();
    expect(fake.primitives.http2Connect).not.toHaveBeenCalled();
  });

  it("rejects a non-200 CONNECT response without opening HTTP/2", async () => {
    const fake = fakePrimitives({ connectResponse: ["HTTP/1.1 407 Proxy Authentication Required\r\n\r\n"] });

    await expect(connectHttp2(TARGET, {
      route: proxyRoute("http://proxy.test:8080"),
      primitives: fake.primitives,
    })).rejects.toThrow("Proxy CONNECT failed with status 407");

    expect(fake.netSocket.destroy).toHaveBeenCalledTimes(1);
    expect(fake.primitives.http2Connect).not.toHaveBeenCalled();
  });

  it("rejects and cleans a proxy socket that closes before CONNECT starts", async () => {
    const fake = fakePrimitives({ autoNetConnect: false });
    const pending = connectHttp2(TARGET, {
      route: proxyRoute("http://proxy.test:8080"),
      primitives: fake.primitives,
    });
    queueMicrotask(() => fake.netSocket.emit("close"));

    await expect(rejectionWithin(pending)).resolves.toMatchObject({ code: "http2_connection_closed" });
    expect(fake.netSocket.destroy).toHaveBeenCalledTimes(1);
    expect(fake.primitives.http2Connect).not.toHaveBeenCalled();
  });

  it("rejects and cleans a CONNECT tunnel peer that ends before its response", async () => {
    const fake = fakePrimitives({ connectResponse: [] });
    fake.netSocket.write.mockImplementation(() => {
      queueMicrotask(() => fake.netSocket.emit("end"));
      return true;
    });

    const pending = connectHttp2(TARGET, {
      route: proxyRoute("http://proxy.test:8080"),
      primitives: fake.primitives,
    });

    await expect(rejectionWithin(pending)).resolves.toMatchObject({ code: "http2_connection_closed" });
    expect(fake.netSocket.destroy).toHaveBeenCalledTimes(1);
    expect(fake.primitives.http2Connect).not.toHaveBeenCalled();
  });

  it("closes failed proxy resources once before non-strict direct fallback", async () => {
    const fake = fakePrimitives({ connectResponse: [] });
    fake.netSocket.write.mockImplementation(() => {
      queueMicrotask(() => fake.netSocket.emit("error", new Error("proxy unavailable")));
      return true;
    });

    const lease = await connectHttp2(TARGET, {
      route: proxyRoute("http://proxy.test:8080", false),
      primitives: fake.primitives,
    });

    expect(fake.netSocket.destroy).toHaveBeenCalledTimes(1);
    expect(lease.effectiveRoute).toEqual({ kind: "direct", strictProxy: false, cacheIdentity: "direct" });
    expect(fake.primitives.http2Connect).toHaveBeenCalledTimes(1);
    lease.close();
    expect(fake.sessions[0].close).toHaveBeenCalledTimes(1);
  });

  it("destroys a returned proxy tunnel once when its HTTP/2 session errors", async () => {
    const fake = fakePrimitives();
    const lease = await connectHttp2(TARGET, {
      route: proxyRoute("http://proxy.test:8080"),
      primitives: fake.primitives,
    });

    fake.sessions[0].emit("error", new Error("session failed"));
    lease.close();

    expect(fake.tlsSockets.at(-1).destroy).toHaveBeenCalledTimes(1);
    expect(fake.sessions[0].close).toHaveBeenCalledTimes(1);
  });

  it("does not direct-fallback from a strict proxy failure", async () => {
    const fake = fakePrimitives({ connectResponse: [] });
    fake.netSocket.write.mockImplementation(() => {
      queueMicrotask(() => fake.netSocket.emit("error", new Error("proxy unavailable")));
      return true;
    });

    await expect(connectHttp2(TARGET, {
      route: proxyRoute("http://proxy.test:8080", true),
      primitives: fake.primitives,
    })).rejects.toThrow("proxy unavailable");

    expect(fake.netSocket.destroy).toHaveBeenCalledTimes(1);
    expect(fake.primitives.http2Connect).not.toHaveBeenCalled();
  });

  it("preserves a caller abort before a pending proxy connection and destroys it once", async () => {
    const fake = fakePrimitives({ autoNetConnect: false });
    const caller = new AbortController();
    const reason = new DOMException("client left", "AbortError");
    const pending = connectHttp2(TARGET, {
      route: proxyRoute("http://proxy.test:8080"),
      signal: caller.signal,
      primitives: fake.primitives,
    });
    caller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(fake.netSocket.destroy).toHaveBeenCalledTimes(1);
    expect(fake.primitives.http2Connect).not.toHaveBeenCalled();
  });

  it("preserves a caller abort while waiting for an HTTP/2 session", async () => {
    const fake = fakePrimitives({ autoHttp2Connect: false });
    const caller = new AbortController();
    const reason = new DOMException("client left", "AbortError");
    const pending = connectHttp2(TARGET, {
      route: { kind: "direct", strictProxy: false, cacheIdentity: "direct" },
      signal: caller.signal,
      primitives: fake.primitives,
    });
    caller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(fake.sessions[0].destroy).toHaveBeenCalledTimes(1);
  });
});
