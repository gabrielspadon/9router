import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const legacyHttp2 = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("http2", () => ({ default: { connect: legacyHttp2.connect } }));

import {
  clearCursorModelCache,
  parseCursorUsableModels,
  resolveCursorModels,
} from "../../open-sse/services/cursorModels.js";
import { resolveEffectiveProxyRoute } from "../../open-sse/utils/proxyFetch.js";

const credentials = {
  accessToken: "cursor-token",
  providerSpecificData: { machineId: "machine-id" },
};
const direct = { resolutionKind: "intentional-direct", reason: "connection-proxy-direct" };
const strictProxy = {
  resolutionKind: "selected-proxy",
  connectionProxyEnabled: true,
  connectionProxyUrl: "https://name:secret@proxy-a.test:8443",
  strictProxy: true,
};
const proxyB = {
  resolutionKind: "selected-proxy",
  connectionProxyEnabled: true,
  connectionProxyUrl: "socks5h://proxy-b.test:1080",
  strictProxy: true,
};
const nonStrictProxy = {
  resolutionKind: "selected-proxy",
  connectionProxyEnabled: true,
  connectionProxyUrl: "http://proxy.test:8080",
  strictProxy: false,
};

function varint(value) {
  const bytes = [];
  while (value >= 0x80) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
  return Uint8Array.from(bytes);
}

function field(fieldNumber, value) {
  return Uint8Array.from([(fieldNumber << 3) | 2, ...varint(value.length), ...value]);
}

function text(value) {
  return new TextEncoder().encode(value);
}

function concat(...parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function model(id, name) {
  return field(1, concat(field(1, text(id)), field(4, text(name))));
}

function protoResponse(models) {
  return { status: 200, body: concat(...models.map(({ id, name }) => model(id, name))) };
}

function lease(effectiveRoute) {
  return { session: {}, effectiveRoute, close: vi.fn() };
}

function route(kind, cacheIdentity, strictProxy = false) {
  return { kind, cacheIdentity, strictProxy };
}

function resolvedRoute(proxyOptions) {
  return resolveEffectiveProxyRoute(
    "https://agent.api5.cursor.sh/agent.v1.AgentService/GetUsableModels",
    proxyOptions,
  );
}

function fakeLegacySession() {
  const client = new EventEmitter();
  client.close = vi.fn();
  client.request = vi.fn(() => {
    const request = new EventEmitter();
    request.end = vi.fn(() => {
      queueMicrotask(() => {
        request.emit("response", { ":status": 503 });
        request.emit("end");
      });
    });
    return request;
  });
  return client;
}

describe("Cursor live model catalog", () => {
  beforeEach(() => {
    clearCursorModelCache();
    legacyHttp2.connect.mockImplementation(fakeLegacySession);
  });

  afterEach(() => {
    clearCursorModelCache();
    vi.clearAllMocks();
  });

  it("decodes the GetUsableModels protobuf response", () => {
    const payload = concat(
      model("default", "Auto"),
      model("gpt-5.3-codex", "GPT 5.3 Codex"),
      model("gpt-5.3-codex", "Duplicate"),
    );

    expect(parseCursorUsableModels(payload)).toEqual([
      { id: "default", name: "Auto" },
      { id: "gpt-5.3-codex", name: "GPT 5.3 Codex" },
    ]);
  });

  it("uses a direct cache hit without opening a second lease or posting", async () => {
    const directLease = lease(route("direct", "direct"));
    const connector = vi.fn().mockResolvedValue(directLease);
    const post = vi.fn().mockResolvedValue(protoResponse([{ id: "direct-model", name: "Direct" }]));

    await expect(resolveCursorModels(credentials, { proxyOptions: direct, connectHttp2: connector, http2Post: post })).resolves.toEqual({
      models: [{ id: "direct-model", name: "Direct" }],
    });
    await expect(resolveCursorModels(credentials, { proxyOptions: direct, connectHttp2: connector, http2Post: post })).resolves.toEqual({
      models: [{ id: "direct-model", name: "Direct" }],
    });

    expect(connector).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(directLease.close).toHaveBeenCalledTimes(1);
  });

  it("partitions direct and distinct proxied catalog cache entries", async () => {
    const connector = vi.fn()
      .mockResolvedValueOnce(lease(route("direct", "direct")))
      .mockResolvedValueOnce(lease(resolvedRoute(strictProxy)))
      .mockResolvedValueOnce(lease(resolvedRoute(proxyB)));
    const post = vi.fn()
      .mockResolvedValueOnce(protoResponse([{ id: "direct", name: "Direct" }]))
      .mockResolvedValueOnce(protoResponse([{ id: "proxy-a", name: "Proxy A" }]))
      .mockResolvedValueOnce(protoResponse([{ id: "proxy-b", name: "Proxy B" }]));

    await resolveCursorModels(credentials, { proxyOptions: direct, connectHttp2: connector, http2Post: post });
    await resolveCursorModels(credentials, { proxyOptions: strictProxy, connectHttp2: connector, http2Post: post });
    await resolveCursorModels(credentials, { proxyOptions: proxyB, connectHttp2: connector, http2Post: post });

    expect(post).toHaveBeenCalledTimes(3);
    expect(connector).toHaveBeenCalledTimes(3);
  });

  it("closes a non-strict fallback-to-direct lease on the effective direct cache hit", async () => {
    const seededDirectLease = lease(route("direct", "direct"));
    const fallbackLease = lease(route("direct", "direct"));
    const seedConnector = vi.fn().mockResolvedValue(seededDirectLease);
    const fallbackConnector = vi.fn().mockResolvedValue(fallbackLease);
    const post = vi.fn().mockResolvedValue(protoResponse([{ id: "direct-model", name: "Direct" }]));

    await resolveCursorModels(credentials, { proxyOptions: direct, connectHttp2: seedConnector, http2Post: post });
    await expect(resolveCursorModels(credentials, {
      proxyOptions: nonStrictProxy,
      connectHttp2: fallbackConnector,
      http2Post: post,
    })).resolves.toEqual({ models: [{ id: "direct-model", name: "Direct" }] });

    expect(fallbackConnector).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(fallbackLease.close).toHaveBeenCalledTimes(1);
  });

  it("closes a strict proxied lease after warming its route-specific cache", async () => {
    const proxyLease = lease(resolvedRoute(strictProxy));
    const connector = vi.fn().mockResolvedValue(proxyLease);
    const post = vi.fn().mockResolvedValue(protoResponse([{ id: "proxy-model", name: "Proxy" }]));

    await resolveCursorModels(credentials, { proxyOptions: strictProxy, connectHttp2: connector, http2Post: post });
    await resolveCursorModels(credentials, { proxyOptions: strictProxy, connectHttp2: connector, http2Post: post });

    expect(connector).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(proxyLease.close).toHaveBeenCalledTimes(1);
  });

  it("bypasses every catalog cache read and overwrites the effective route on force refresh", async () => {
    const oldLease = lease(route("direct", "direct"));
    const refreshedLease = lease(route("direct", "direct"));
    const connector = vi.fn()
      .mockResolvedValueOnce(oldLease)
      .mockResolvedValueOnce(refreshedLease);
    const oldPost = vi.fn().mockResolvedValue(protoResponse([{ id: "old", name: "Old" }]));
    const refreshedPost = vi.fn().mockResolvedValue(protoResponse([{ id: "new", name: "New" }]));

    await resolveCursorModels(credentials, { proxyOptions: direct, connectHttp2: connector, http2Post: oldPost });
    await resolveCursorModels(credentials, {
      forceRefresh: true,
      proxyOptions: direct,
      connectHttp2: connector,
      http2Post: refreshedPost,
    });
    await expect(resolveCursorModels(credentials, {
      proxyOptions: direct,
      connectHttp2: vi.fn(),
      http2Post: vi.fn(),
    })).resolves.toEqual({ models: [{ id: "new", name: "New" }] });

    expect(refreshedPost).toHaveBeenCalledTimes(1);
    expect(connector).toHaveBeenCalledTimes(2);
    expect(refreshedLease.close).toHaveBeenCalledTimes(1);
  });

  it("force refresh replaces a seeded strict proxy entry without opening a cache-hit lease", async () => {
    const seededLease = lease(resolvedRoute(strictProxy));
    const refreshedLease = lease(resolvedRoute(strictProxy));
    const connector = vi.fn()
      .mockResolvedValueOnce(seededLease)
      .mockResolvedValueOnce(refreshedLease);
    const seedPost = vi.fn().mockResolvedValue(protoResponse([{ id: "old-proxy", name: "Old proxy" }]));
    const refreshPost = vi.fn().mockResolvedValue(protoResponse([{ id: "new-proxy", name: "New proxy" }]));

    await resolveCursorModels(credentials, { proxyOptions: strictProxy, connectHttp2: connector, http2Post: seedPost });
    await resolveCursorModels(credentials, {
      forceRefresh: true,
      proxyOptions: strictProxy,
      connectHttp2: connector,
      http2Post: refreshPost,
    });
    await expect(resolveCursorModels(credentials, {
      proxyOptions: strictProxy,
      connectHttp2: vi.fn(),
      http2Post: vi.fn(),
    })).resolves.toEqual({ models: [{ id: "new-proxy", name: "New proxy" }] });

    expect(connector).toHaveBeenCalledTimes(2);
    expect(seedPost).toHaveBeenCalledTimes(1);
    expect(refreshPost).toHaveBeenCalledTimes(1);
    expect(seededLease.close).toHaveBeenCalledTimes(1);
    expect(refreshedLease.close).toHaveBeenCalledTimes(1);
  });

  it("force refresh replaces a seeded direct entry through a non-strict proxy fallback", async () => {
    const seededLease = lease(route("direct", "direct"));
    const fallbackLease = lease(route("direct", "direct"));
    const seedConnector = vi.fn().mockResolvedValue(seededLease);
    const fallbackConnector = vi.fn().mockResolvedValue(fallbackLease);
    const seedPost = vi.fn().mockResolvedValue(protoResponse([{ id: "old-direct", name: "Old direct" }]));
    const refreshPost = vi.fn().mockResolvedValue(protoResponse([{ id: "new-direct", name: "New direct" }]));

    await resolveCursorModels(credentials, { proxyOptions: direct, connectHttp2: seedConnector, http2Post: seedPost });
    await resolveCursorModels(credentials, {
      forceRefresh: true,
      proxyOptions: nonStrictProxy,
      connectHttp2: fallbackConnector,
      http2Post: refreshPost,
    });
    await expect(resolveCursorModels(credentials, {
      proxyOptions: direct,
      connectHttp2: vi.fn(),
      http2Post: vi.fn(),
    })).resolves.toEqual({ models: [{ id: "new-direct", name: "New direct" }] });

    expect(seedPost).toHaveBeenCalledTimes(1);
    expect(refreshPost).toHaveBeenCalledTimes(1);
    expect(fallbackConnector).toHaveBeenCalledTimes(1);
    expect(seededLease.close).toHaveBeenCalledTimes(1);
    expect(fallbackLease.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["relay", { resolutionKind: "selected-proxy", vercelRelayUrl: "https://relay.test", strictProxy: true }],
    ["required-unavailable", { resolutionKind: "required-unavailable", reason: "pool-missing", strictProxy: true }],
  ])("returns typed %s without catalog transport", async (_name, proxyOptions) => {
    const connector = vi.fn();
    const post = vi.fn();

    await expect(resolveCursorModels(credentials, { proxyOptions, connectHttp2: connector, http2Post: post })).resolves.toMatchObject({
      unavailable: true,
    });
    expect(connector).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(legacyHttp2.connect).not.toHaveBeenCalled();
  });

  it.each([
    ["relay", { resolutionKind: "selected-proxy", vercelRelayUrl: "https://relay.test", strictProxy: true }],
    ["required-unavailable", { resolutionKind: "required-unavailable", reason: "pool-missing", strictProxy: true }],
  ])("does not expose a seeded direct cache through %s unavailable catalog routes", async (_name, proxyOptions) => {
    const seededLease = lease(route("direct", "direct"));
    const seedConnector = vi.fn().mockResolvedValue(seededLease);
    const seedPost = vi.fn().mockResolvedValue(protoResponse([{ id: "direct-model", name: "Direct" }]));
    const connector = vi.fn();
    const post = vi.fn();

    await resolveCursorModels(credentials, { proxyOptions: direct, connectHttp2: seedConnector, http2Post: seedPost });
    await expect(resolveCursorModels(credentials, { proxyOptions, connectHttp2: connector, http2Post: post })).resolves.toMatchObject({
      unavailable: true,
    });

    expect(connector).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("fails open on an ordinary catalog post failure while closing its lease", async () => {
    const directLease = lease(route("direct", "direct"));
    const connector = vi.fn().mockResolvedValue(directLease);
    const post = vi.fn().mockRejectedValue(new Error("catalog failed"));

    await expect(resolveCursorModels(credentials, { proxyOptions: direct, connectHttp2: connector, http2Post: post })).resolves.toBeNull();
    expect(directLease.close).toHaveBeenCalledTimes(1);
  });

  it("maps a propagated required-unavailable model error to the typed kind response", async () => {
    vi.resetModules();
    vi.doMock("../../src/app/api/v1/models/route.js", () => ({
      buildModelsList: vi.fn().mockRejectedValue(Object.assign(new Error("Required proxy is unavailable"), {
        code: "required_proxy_unavailable",
        status: 503,
      })),
    }));
    vi.doMock("../../src/lib/network/connectionProxy.js", () => ({
      isRequiredProxyUnavailableError: (error) => error?.code === "required_proxy_unavailable",
    }));

    try {
      const { GET } = await import("../../src/app/api/v1/models/[...kind]/route.js");
      const response = await GET(
        new Request("http://localhost/v1/models/image"),
        { params: Promise.resolve({ kind: "image" }) },
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: "Required proxy is unavailable",
        code: "required_proxy_unavailable",
      });
    } finally {
      vi.doUnmock("../../src/app/api/v1/models/route.js");
      vi.doUnmock("../../src/lib/network/connectionProxy.js");
      vi.resetModules();
    }
  });
});
