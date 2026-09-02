import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(async () => ({})),
  resolveConnectionProxyConfig: vi.fn(async () => ({
    kind: "usable",
    resolutionKind: "unselected",
    connectionProxyEnabled: false,
    connectionProxyUrl: "",
    connectionNoProxy: "",
    proxyPoolId: null,
    vercelRelayUrl: "",
  })),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => []),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
  updateConnectionProxyPoolSnapshotIfBound: vi.fn(),
  updateProviderStrategyProxyPoolSnapshotIfBound: vi.fn(),
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn(async () => []),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  toConnectionProxyOptions: vi.fn((config) => ({ ...config })),
  pickProxyPoolId: vi.fn(() => null),
}));

describe("#2650 an operator can take a no-auth provider out of rotation", () => {
  let getProviderCredentials;
  let isProviderDisabled;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({});
    ({ getProviderCredentials } = await import("../../src/sse/services/auth.js"));
    ({ isProviderDisabled } = await import("../../src/shared/constants/providers.js"));
  });

  it("still hands out the virtual connection while nothing is disabled", async () => {
    await expect(getProviderCredentials("opencode")).resolves.toMatchObject({
      connectionId: "noauth",
      isActive: true,
      accessToken: "public",
    });
  });

  it("refuses credentials for a disabled no-auth provider before any proxy work", async () => {
    mocks.getSettings.mockResolvedValue({ disabledProviders: { opencode: true } });

    await expect(getProviderCredentials("opencode")).resolves.toBeNull();
    expect(mocks.resolveConnectionProxyConfig).not.toHaveBeenCalled();
  });

  it("honours the setting through a provider alias, so `oc` cannot route around it", async () => {
    mocks.getSettings.mockResolvedValue({ disabledProviders: { opencode: true } });

    await expect(getProviderCredentials("oc")).resolves.toBeNull();
  });

  it("only treats an exact true as disabled, so stale junk never benches a provider", () => {
    expect(isProviderDisabled({ disabledProviders: { opencode: "true" } }, "opencode")).toBe(false);
    expect(isProviderDisabled({ disabledProviders: { opencode: true } }, "oc")).toBe(true);
    expect(isProviderDisabled(undefined, "opencode")).toBe(false);
  });
});

describe("#2650 the disabledProviders patch is validated at the API boundary", () => {
  const signals = ["beforeExit", "SIGINT", "SIGTERM", "exit"];
  let dataDir;
  let priorDataDir;
  let priorDataDirPresent;
  let listenerBaseline;
  let repository;
  let PATCH;

  function settingsRequest(payload) {
    return new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "tokenproxy-disabled-providers-"));
    priorDataDirPresent = Object.prototype.hasOwnProperty.call(process.env, "DATA_DIR");
    priorDataDir = process.env.DATA_DIR;
    listenerBaseline = Object.fromEntries(
      signals.map((signal) => [signal, process.listeners(signal).slice()]),
    );
    process.env.DATA_DIR = dataDir;
    delete global._dbAdapter;
    vi.resetModules();
    vi.doUnmock("@/lib/localDb");
    vi.doUnmock("@/lib/network/connectionProxy");
    repository = await import("../../src/lib/db/repos/settingsRepo.js");
    ({ PATCH } = await import("../../src/app/api/settings/route.js"));
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
      delete globalThis.__tokenproxyShutdownState;
      vi.resetModules();
      if (priorDataDirPresent) process.env.DATA_DIR = priorDataDir;
      else delete process.env.DATA_DIR;
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("reads back an explicit empty map on a fresh install", async () => {
    expect((await repository.getSettings()).disabledProviders).toEqual({});
  });

  it("persists a boolean map", async () => {
    const response = await PATCH(settingsRequest({ disabledProviders: { opencode: true } }));
    expect(response.status).toBe(200);
    expect((await repository.getSettings()).disabledProviders).toEqual({ opencode: true });
  });

  it("rejects a non-boolean value without writing anything", async () => {
    const before = await repository.exportSettings();
    const response = await PATCH(settingsRequest({ disabledProviders: { opencode: "yes" } }));
    expect(response.status).toBe(400);
    expect(await repository.exportSettings()).toEqual(before);
  });

  it("rejects a non-object patch without writing anything", async () => {
    const before = await repository.exportSettings();
    const response = await PATCH(settingsRequest({ disabledProviders: ["opencode"] }));
    expect(response.status).toBe(400);
    expect(await repository.exportSettings()).toEqual(before);
  });
});
