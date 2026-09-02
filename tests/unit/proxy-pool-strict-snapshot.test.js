import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalDataDir = process.env.DATA_DIR;
const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];

let dataDir;
let listenerBaseline;
let models;
let settingsRepository;
let getAdapter;
let PUT;

function poolRequest(payload) {
  return new Request("http://localhost/api/proxy-pools/pool-a", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function createBoundRecords(strictProxy = false) {
  await models.createProxyPool({
    id: "pool-a",
    name: "Pool A",
    proxyUrl: "https://proxy.example.test:8443",
    strictProxy,
    isActive: true,
  });
  const connection = await models.createProviderConnection({
    provider: "openai",
    authType: "apikey",
    name: "Connection A",
    apiKey: "secret",
    providerSpecificData: {
      keep: "connection-data",
      proxyPoolId: "pool-a",
      strictProxy,
    },
  });
  await settingsRepository.updateSettings({
    providerStrategies: {
      "mimo-free": {
        rotateStrategy: "none",
        keep: "strategy-data",
        proxyPoolId: "pool-a",
        strictProxy,
      },
    },
  });
  return connection;
}

async function readBoundRecords(connectionId) {
  const connection = await models.getProviderConnectionById(connectionId);
  const settings = await settingsRepository.getSettings();
  const pool = await models.getProxyPoolById("pool-a");
  return { connection, settings, pool };
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "tokenproxy-proxy-snapshot-"));
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
  settingsRepository = await import("@/lib/db/repos/settingsRepo.js");
  ({ getAdapter } = await import("@/lib/db/driver.js"));
  ({ PUT } = await import("@/app/api/proxy-pools/[id]/route.js"));
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
    delete globalThis.__tokenproxyShutdownState;
    vi.doUnmock("next/server");
    vi.resetModules();
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  }
});

describe("proxy-pool strict snapshots", () => {
  it("updates normal and no-auth snapshots in one pool PUT transaction", async () => {
    const connection = await createBoundRecords(false);

    const response = await PUT(poolRequest({ strictProxy: true }), {
      params: Promise.resolve({ id: "pool-a" }),
    });

    expect(response.status).toBe(200);
    const { connection: stored, settings, pool } = await readBoundRecords(connection.id);
    expect(pool.strictProxy).toBe(true);
    expect(stored.providerSpecificData).toMatchObject({
      keep: "connection-data",
      proxyPoolId: "pool-a",
      strictProxy: true,
    });
    expect(settings.providerStrategies["mimo-free"]).toMatchObject({
      keep: "strategy-data",
      proxyPoolId: "pool-a",
      strictProxy: true,
    });
  });

  it("rolls back pool and snapshots when a fan-out write fails", async () => {
    const connection = await createBoundRecords(false);
    const before = await readBoundRecords(connection.id);
    const adapter = await getAdapter();
    const originalRun = adapter.run.bind(adapter);
    adapter.run = (sql, params) => {
      if (/UPDATE providerConnections SET data/.test(sql)) {
        throw new Error("injected connection fan-out failure");
      }
      return originalRun(sql, params);
    };

    try {
      const response = await PUT(poolRequest({ strictProxy: true }), {
        params: Promise.resolve({ id: "pool-a" }),
      });
      expect(response.status).toBe(500);
    } finally {
      adapter.run = originalRun;
    }

    expect(await readBoundRecords(connection.id)).toEqual(before);
  });

  it("does not overwrite a concurrently rebound connection snapshot", async () => {
    const connection = await createBoundRecords(false);
    await models.updateProviderConnection(connection.id, {
      providerSpecificData: { proxyPoolId: "pool-b", strictProxy: false },
    });

    const result = await models.updateConnectionProxyPoolSnapshotIfBound(
      connection.id,
      "pool-a",
      { proxyPoolId: "pool-a", strictProxy: true },
    );

    expect(result).toBeNull();
    expect((await models.getProviderConnectionById(connection.id)).providerSpecificData)
      .toEqual({ proxyPoolId: "pool-b", strictProxy: false });
  });

  it("does not overwrite a concurrently rebound no-auth strategy snapshot", async () => {
    await createBoundRecords(false);
    await settingsRepository.updateProviderStrategy("mimo-free", {
      proxyPoolId: "pool-b",
      strictProxy: false,
    });

    const result = await models.updateProviderStrategyProxyPoolSnapshotIfBound(
      "mimo-free",
      "pool-a",
      { proxyPoolId: "pool-a", strictProxy: true },
    );

    expect(result).toBeNull();
    expect((await settingsRepository.getSettings()).providerStrategies["mimo-free"])
      .toMatchObject({ proxyPoolId: "pool-b", strictProxy: false });
  });
});
