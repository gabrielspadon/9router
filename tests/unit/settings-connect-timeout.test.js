import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dataDir;
let priorDataDir;
let priorDataDirPresent;
let listenerBaseline;
let repository;
let GET;
let PATCH;

const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];

function settingsRequest(payload) {
  return new Request("http://localhost/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function rawSettingsRequest(json) {
  return new Request("http://localhost/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: json,
  });
}

async function expectRejectedWithoutWrite(request) {
  const before = await repository.exportSettings();
  const response = await PATCH(request);
  expect(response.status).toBe(400);
  expect(await repository.exportSettings()).toEqual(before);
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "9router-timeout-settings-"));
  priorDataDirPresent = Object.prototype.hasOwnProperty.call(process.env, "DATA_DIR");
  priorDataDir = process.env.DATA_DIR;
  listenerBaseline = Object.fromEntries(
    signals.map((signal) => [signal, process.listeners(signal).slice()]),
  );
  process.env.DATA_DIR = dataDir;
  delete global._dbAdapter;
  vi.resetModules();
  repository = await import("../../src/lib/db/repos/settingsRepo.js");
  ({ GET, PATCH } = await import("../../src/app/api/settings/route.js"));
});

afterEach(async () => {
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
    vi.resetModules();
    if (priorDataDirPresent) process.env.DATA_DIR = priorDataDir;
    else delete process.env.DATA_DIR;
    rmSync(dataDir, { recursive: true, force: true });
  }
});

describe("connect timeout settings repository", () => {
  it("merges 15000 into an old row without writing it", async () => {
    expect((await repository.getSettings()).connectTimeoutMs).toBe(15000);
    expect(await repository.exportSettings()).not.toHaveProperty("connectTimeoutMs");
  });

  it("uses 15000 in memory for an invalid imported global without rewriting raw data", async () => {
    await repository.updateSettings({ connectTimeoutMs: "15000" });
    expect((await repository.getSettings()).connectTimeoutMs).toBe(15000);
    expect((await repository.exportSettings()).connectTimeoutMs).toBe("15000");
  });

  it("drops an invalid imported provider override in memory while preserving its siblings and raw data", async () => {
    await repository.updateSettings({
      providerStrategies: {
        qoder: { fallbackStrategy: "round-robin", connectTimeoutMs: "8000" },
      },
    });
    expect((await repository.getSettings()).providerStrategies.qoder).toEqual({
      fallbackStrategy: "round-robin",
    });
    expect((await repository.exportSettings()).providerStrategies.qoder.connectTimeoutMs).toBe("8000");
  });

  it("atomically patches siblings and deletes only null fields", async () => {
    await repository.updateSettings({
      providerStrategies: {
        qoder: {
          fallbackStrategy: "round-robin",
          stickyRoundRobinLimit: 2,
          proxyPoolId: "pool-a",
          rotateStrategy: "random",
        },
      },
    });
    await repository.updateProviderStrategy("qoder", { connectTimeoutMs: 8000 });
    expect((await repository.getSettings()).providerStrategies.qoder).toEqual({
      fallbackStrategy: "round-robin",
      stickyRoundRobinLimit: 2,
      proxyPoolId: "pool-a",
      rotateStrategy: "random",
      connectTimeoutMs: 8000,
    });
    await repository.updateProviderStrategy("qoder", { connectTimeoutMs: null });
    expect((await repository.getSettings()).providerStrategies.qoder).toEqual({
      fallbackStrategy: "round-robin",
      stickyRoundRobinLimit: 2,
      proxyPoolId: "pool-a",
      rotateStrategy: "random",
    });
  });

  it("serializes concurrent provider patches without losing fields", async () => {
    await Promise.all([
      repository.updateProviderStrategy("qoder", { connectTimeoutMs: 8000 }),
      repository.updateProviderStrategy("qoder", { proxyPoolId: "pool-b" }),
    ]);
    expect((await repository.getSettings()).providerStrategies.qoder).toMatchObject({
      connectTimeoutMs: 8000,
      proxyPoolId: "pool-b",
    });
  });
});

describe("connect timeout settings route", () => {
  it("GET exposes the in-memory default without migrating or leaking secrets", async () => {
    await repository.updateSettings({
      password: "stored-hash",
      oidcIssuerUrl: "https://issuer.test",
      oidcClientId: "client-id",
      oidcClientSecret: "client-secret",
    });
    const rawBefore = await repository.exportSettings();
    expect(rawBefore).not.toHaveProperty("connectTimeoutMs");
    const response = await GET(new Request("http://localhost/api/settings"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.connectTimeoutMs).toBe(15000);
    expect(body).not.toHaveProperty("password");
    expect(body).not.toHaveProperty("oidcClientSecret");
    expect(body.oidcConfigured).toBe(true);
    expect(await repository.exportSettings()).toEqual(rawBefore);
  });

  it("persists a valid global timeout", async () => {
    const response = await PATCH(settingsRequest({ connectTimeoutMs: 20000 }));
    expect(response.status).toBe(200);
    expect((await response.json()).connectTimeoutMs).toBe(20000);
    expect((await repository.exportSettings()).connectTimeoutMs).toBe(20000);
  });

  it.each([999, 120001, 15000.5, "15000", null, true])(
    "rejects invalid global literal %s",
    async (connectTimeoutMs) => {
      await expectRejectedWithoutWrite(settingsRequest({ connectTimeoutMs }));
    },
  );

  it("rejects parsed numeric overflow rather than JSON-stringifying it to null", async () => {
    await expectRejectedWithoutWrite(rawSettingsRequest('{"connectTimeoutMs":1e400}'));
  });

  it("rejects mixed provider command and ordinary settings", async () => {
    await expectRejectedWithoutWrite(settingsRequest({
      connectTimeoutMs: 15000,
      providerStrategyPatch: { providerId: "qoder", values: { connectTimeoutMs: 8000 } },
    }));
  });

  it("persists one provider field without losing siblings", async () => {
    await repository.updateSettings({
      providerStrategies: {
        qoder: { fallbackStrategy: "round-robin", proxyPoolId: "pool-b" },
      },
    });
    const response = await PATCH(settingsRequest({
      providerStrategyPatch: { providerId: "qoder", values: { connectTimeoutMs: 8000 } },
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).providerStrategies.qoder).toMatchObject({
      fallbackStrategy: "round-robin",
      proxyPoolId: "pool-b",
      connectTimeoutMs: 8000,
    });
  });

  it.each([
    {},
    { providerId: "   ", values: {} },
    { providerId: "qoder", values: null },
    { providerId: "qoder", values: [] },
  ])("rejects malformed provider command %#", async (providerStrategyPatch) => {
    await expectRejectedWithoutWrite(settingsRequest({ providerStrategyPatch }));
  });

  it.each(["__proto__", "prototype", "constructor"])(
    "rejects dangerous provider id %s",
    async (providerId) => {
      await expectRejectedWithoutWrite(settingsRequest({
        providerStrategyPatch: { providerId, values: { connectTimeoutMs: 8000 } },
      }));
    },
  );

  it.each(["__proto__", "prototype", "constructor"])(
    "rejects dangerous provider value key %s",
    async (key) => {
      await expectRejectedWithoutWrite(rawSettingsRequest(
        `{"providerStrategyPatch":{"providerId":"qoder","values":{"${key}":true}}}`,
      ));
    },
  );

  it.each([999, 120001, 15000.5, "8000", true])(
    "rejects invalid nested timeout %s",
    async (connectTimeoutMs) => {
      await expectRejectedWithoutWrite(settingsRequest({
        providerStrategyPatch: { providerId: "qoder", values: { connectTimeoutMs } },
      }));
    },
  );

  it("rejects nested numeric overflow", async () => {
    await expectRejectedWithoutWrite(rawSettingsRequest(
      '{"providerStrategyPatch":{"providerId":"qoder","values":{"connectTimeoutMs":1e400}}}',
    ));
  });

  it("rejects unknown siblings beside a provider command", async () => {
    await expectRejectedWithoutWrite(settingsRequest({
      providerStrategyPatch: { providerId: "qoder", values: { connectTimeoutMs: 8000 } },
      unrelated: true,
    }));
  });

  it.each([
    { providerStrategies: null },
    { providerStrategies: [] },
    { providerStrategies: { qoder: null } },
    { providerStrategies: { qoder: [] } },
    { providerStrategies: { qoder: { connectTimeoutMs: "15000" } } },
  ])("rejects unsafe legacy provider strategy map %#", async (payload) => {
    await expectRejectedWithoutWrite(settingsRequest(payload));
  });

  it("rejects dangerous provider ids in the legacy map", async () => {
    await expectRejectedWithoutWrite(rawSettingsRequest(
      '{"providerStrategies":{"__proto__":{"connectTimeoutMs":8000}}}',
    ));
  });

  it("accepts a valid legacy provider strategy map", async () => {
    const response = await PATCH(settingsRequest({
      providerStrategies: {
        qoder: { fallbackStrategy: "round-robin", connectTimeoutMs: 8000 },
      },
    }));
    expect(response.status).toBe(200);
    expect((await repository.getSettings()).providerStrategies.qoder).toEqual({
      fallbackStrategy: "round-robin",
      connectTimeoutMs: 8000,
    });
  });

  it("atomically persists and deletes Codex Fast without losing siblings", async () => {
    await repository.updateSettings({
      providerStrategies: {
        codex: { fallbackStrategy: "round-robin", connectTimeoutMs: 9000 },
      },
    });

    const enabled = await PATCH(settingsRequest({
      providerStrategyPatch: { providerId: "codex", values: { fastMode: true } },
    }));
    expect(enabled.status).toBe(200);
    expect((await enabled.json()).providerStrategies.codex).toEqual({
      fallbackStrategy: "round-robin",
      connectTimeoutMs: 9000,
      fastMode: true,
    });

    const disabled = await PATCH(settingsRequest({
      providerStrategyPatch: { providerId: "codex", values: { fastMode: null } },
    }));
    expect(disabled.status).toBe(200);
    expect((await disabled.json()).providerStrategies.codex).toEqual({
      fallbackStrategy: "round-robin",
      connectTimeoutMs: 9000,
    });
  });

  it.each(["true", 1, 0, {}, []])(
    "rejects invalid atomic Codex Fast literal %# without a write",
    async (fastMode) => {
      await expectRejectedWithoutWrite(settingsRequest({
        providerStrategyPatch: { providerId: "codex", values: { fastMode } },
      }));
    },
  );

  it("accepts a boolean Codex Fast value in the legacy strategy map", async () => {
    const response = await PATCH(settingsRequest({
      providerStrategies: { codex: { fastMode: false } },
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).providerStrategies.codex.fastMode).toBe(false);
  });

  it.each([null, "true", 1, {}, []])(
    "rejects invalid legacy Codex Fast literal %# without a write",
    async (fastMode) => {
      await expectRejectedWithoutWrite(settingsRequest({
        providerStrategies: { codex: { fastMode } },
      }));
    },
  );
});
