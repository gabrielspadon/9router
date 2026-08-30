import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalDataDir = process.env.DATA_DIR;
const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];

let dataDir;
let listenerBaseline;
let models;
let POST;
let PUT;

function request(method, payload) {
  return new Request("http://localhost/api/providers", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function providerPayload(overrides = {}) {
  return {
    provider: "openai",
    apiKey: "test-key",
    name: "OpenAI Test",
    ...overrides,
  };
}

async function createExisting(providerSpecificData = {}) {
  return models.createProviderConnection({
    provider: "openai",
    authType: "apikey",
    name: "Existing OpenAI",
    apiKey: "test-key",
    providerSpecificData,
  });
}

async function patch(connection, payload) {
  return PUT(request("PUT", payload), {
    params: Promise.resolve({ id: connection.id }),
  });
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "9router-provider-proxy-"));
  listenerBaseline = Object.fromEntries(
    signals.map((signal) => [signal, process.listeners(signal).slice()]),
  );
  process.env.DATA_DIR = dataDir;
  delete global._dbAdapter;
  vi.resetModules();
  vi.doMock("next/server", () => ({
    NextResponse: {
      json(body, init = {}) {
        return new Response(JSON.stringify(body), {
          status: init.status || 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  }));
  models = await import("@/models/index.js");
  ({ POST } = await import("@/app/api/providers/route.js"));
  ({ PUT } = await import("@/app/api/providers/[id]/route.js"));
});

afterEach(() => {
  try {
    global._dbAdapter?.instance?.close?.();
  } finally {
    delete global._dbAdapter;
    for (const signal of signals) {
      for (const listener of process.listeners(signal)) {
        if (!listenerBaseline[signal].includes(listener)) {
          process.removeListener(signal, listener);
        }
      }
    }
    delete globalThis.__9routerShutdownState;
    vi.doUnmock("next/server");
    vi.resetModules();
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});

describe("provider proxy write ownership", () => {
  it("POST omits the historical tuple smuggled through provider data", async () => {
    const response = await POST(request("POST", providerPayload({
      providerSpecificData: {
        keep: "safe",
        connectionProxyEnabled: false,
        connectionProxyUrl: "",
        connectionNoProxy: "",
        connectionProxyMode: "direct",
        proxyPoolId: "pool-smuggled",
        strictProxy: true,
      },
    })));

    expect(response.status).toBe(201);
    const { connection } = await response.json();
    expect(connection.providerSpecificData).toEqual({ keep: "safe" });
  });

  it("POST records explicit local direct separately from no selection", async () => {
    const response = await POST(request("POST", providerPayload({
      connectionProxyEnabled: false,
    })));

    expect(response.status).toBe(201);
    const { connection } = await response.json();
    expect(connection.providerSpecificData).toEqual({ connectionProxyMode: "direct" });
  });

  it("POST writes only the explicit supported proxy policy", async () => {
    const response = await POST(request("POST", providerPayload({
      connectionProxyEnabled: true,
      connectionProxyUrl: "socks5h://proxy.example.test:1080",
      connectionNoProxy: "api.example.test",
    })));

    expect(response.status).toBe(201);
    const { connection } = await response.json();
    expect(connection.providerSpecificData).toEqual({
      connectionProxyMode: "proxy",
      connectionProxyEnabled: true,
      connectionProxyUrl: "socks5h://proxy.example.test:1080",
      connectionNoProxy: "api.example.test",
    });
  });

  it("rejects no-proxy without an explicit enabled supported URL", async () => {
    const response = await POST(request("POST", providerPayload({
      connectionNoProxy: "api.example.test",
    })));

    expect(response.status).toBe(400);
    expect(await models.getProviderConnections({ provider: "openai" })).toEqual([]);
  });

  it("rejects combining a selected pool with legacy connection proxy fields", async () => {
    await models.createProxyPool({
      id: "pool-a",
      name: "Pool A",
      proxyUrl: "http://proxy.example.test:8080",
      isActive: true,
    });
    const response = await POST(request("POST", providerPayload({
      proxyPoolId: "pool-a",
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://other.example.test:8080",
    })));

    expect(response.status).toBe(400);
    expect(await models.getProviderConnections({ provider: "openai" })).toEqual([]);
  });

  it("derives and clears the complete active pool selection pair", async () => {
    const pool = await models.createProxyPool({
      id: "pool-a",
      name: "Pool A",
      proxyUrl: "https://proxy.example.test:8443",
      strictProxy: true,
      isActive: true,
    });
    const created = await POST(request("POST", providerPayload({ proxyPoolId: pool.id })));
    const { connection } = await created.json();

    expect(created.status).toBe(201);
    expect(connection.providerSpecificData).toEqual({
      proxyPoolId: pool.id,
      strictProxy: true,
    });

    const cleared = await patch(connection, { proxyPoolId: null });
    expect(cleared.status).toBe(200);
    expect((await models.getProviderConnectionById(connection.id)).providerSpecificData)
      .toEqual({});

    const rejected = await patch(connection, { proxyPoolId: pool.id, strictProxy: false });
    expect(rejected.status).toBe(400);
    expect((await models.getProviderConnectionById(connection.id)).providerSpecificData)
      .toEqual({});
  });

  it("POST maps __none__ to the persisted direct marker", async () => {
    const response = await POST(request("POST", providerPayload({ proxyPoolId: "__none__" })));

    expect(response.status).toBe(201);
    const { connection } = await response.json();
    expect(connection.providerSpecificData).toEqual({ connectionProxyMode: "direct" });
  });

  it("PATCH maps __none__ to the persisted direct marker and clears a pool pair", async () => {
    const connection = await createExisting({
      keep: "safe",
      proxyPoolId: "pool-a",
      strictProxy: true,
    });
    const response = await patch(connection, { proxyPoolId: "__none__" });

    expect(response.status).toBe(200);
    expect((await models.getProviderConnectionById(connection.id)).providerSpecificData)
      .toEqual({ keep: "safe", connectionProxyMode: "direct" });
  });

  it("PATCH lazily clears only the exact historical default tuple", async () => {
    const connection = await createExisting({
      keep: "safe",
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",
    });
    const response = await patch(connection, { providerSpecificData: { updated: "yes" } });

    expect(response.status).toBe(200);
    expect((await models.getProviderConnectionById(connection.id)).providerSpecificData)
      .toEqual({ keep: "safe", updated: "yes" });
  });

  it("PATCH retains a false strict snapshot when a pooled record has a legacy tuple", async () => {
    const connection = await createExisting({
      keep: "safe",
      proxyPoolId: "pool-a",
      strictProxy: false,
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",
    });
    const response = await patch(connection, { providerSpecificData: { updated: "yes" } });

    expect(response.status).toBe(200);
    expect((await models.getProviderConnectionById(connection.id)).providerSpecificData)
      .toEqual({
        keep: "safe",
        updated: "yes",
        proxyPoolId: "pool-a",
        strictProxy: false,
      });
  });
});
