import { beforeEach, describe, expect, it, vi } from "vitest";

const state = { current: null };
const settings = { current: { tunnelEnabled: false, tunnelUrl: "" } };
const spawnQuickTunnel = vi.fn();
const workerFetch = vi.fn();
const updateSettings = vi.fn();

vi.mock("@/lib/tunnel/shared/state.js", () => ({
  loadState: () => state.current,
  saveState: (next) => {
    state.current = next;
  },
  generateShortId: () => "race3026",
}));

vi.mock("@/lib/tunnel/cloudflare/cloudflared.js", () => ({
  isCloudflaredRunning: () => false,
  killCloudflared: () => {},
  setUnexpectedExitHandler: () => {},
  spawnQuickTunnel: (...args) => spawnQuickTunnel(...args),
}));

vi.mock("@/lib/tunnel/cloudflare/workerFetch.js", () => ({
  workerFetch: (...args) => workerFetch(...args),
}));

vi.mock("@/lib/tunnel/cloudflare/healthCheck.js", () => ({
  probeUrlAlive: async () => true,
  waitForHealth: async (urls) => urls.find(Boolean),
}));

vi.mock("@/lib/tunnel/cloudflare/pid.js", () => ({ clearPid: () => {} }));

vi.mock("@/lib/localDb", () => ({
  getSettings: async () => settings.current,
  updateSettings: (...args) => updateSettings(...args),
}));

const { disableTunnel, enableTunnel, getTunnelService } =
  await import("@/lib/tunnel/cloudflare/manager.js");

const accepted = () => new Response("{}", { status: 200 });

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  state.current = null;
  settings.current = { tunnelEnabled: false, tunnelUrl: "" };
  spawnQuickTunnel.mockReset();
  workerFetch.mockReset();
  updateSettings.mockReset();
  workerFetch.mockResolvedValue(accepted());
  updateSettings.mockImplementation(async (next) => {
    settings.current = { ...settings.current, ...next };
  });

  const svc = getTunnelService();
  svc.cancelToken = { cancelled: false };
  svc.spawnInProgress = false;
  svc.activeLocalPort = null;
});

describe("tunnel enable lifecycle (#3026)", () => {
  it("coalesces concurrent enables before spawning cloudflared", async () => {
    spawnQuickTunnel.mockResolvedValue({
      tunnelUrl: "https://race.trycloudflare.com",
    });

    await Promise.all([enableTunnel(20128), enableTunnel(20128)]);

    expect(spawnQuickTunnel).toHaveBeenCalledTimes(1);
  });

  it("does not resurrect the tunnel after disable wins during registration", async () => {
    const registration = deferred();
    spawnQuickTunnel.mockResolvedValue({
      tunnelUrl: "https://race.trycloudflare.com",
    });
    workerFetch.mockReturnValue(registration.promise);

    const enabling = enableTunnel(20128);
    await vi.waitFor(() => expect(workerFetch).toHaveBeenCalledTimes(1));
    await disableTunnel();
    registration.resolve(accepted());

    await expect(enabling).rejects.toThrow("tunnel cancelled");
    expect(state.current).toBeNull();
    expect(updateSettings).toHaveBeenLastCalledWith({
      tunnelEnabled: false,
      tunnelUrl: "",
    });
  });

  it("starts a fresh enable requested while a canceled enable is settling", async () => {
    const registration = deferred();
    spawnQuickTunnel.mockResolvedValue({
      tunnelUrl: "https://race.trycloudflare.com",
    });
    workerFetch
      .mockReturnValueOnce(registration.promise)
      .mockResolvedValue(accepted());

    const canceledEnable = enableTunnel(20128);
    await vi.waitFor(() => expect(workerFetch).toHaveBeenCalledTimes(1));
    await disableTunnel();
    const retry = enableTunnel(20128);
    registration.resolve(accepted());

    await expect(canceledEnable).rejects.toThrow("tunnel cancelled");
    await expect(retry).resolves.toMatchObject({ success: true });
    expect(spawnQuickTunnel).toHaveBeenCalledTimes(2);
  });

  it("contains a failed URL-change persistence callback", async () => {
    let onUrlUpdate;
    const persistenceError = new Error("database unavailable");
    spawnQuickTunnel.mockImplementation(async (_port, callback) => {
      onUrlUpdate = callback;
      return { tunnelUrl: "https://race.trycloudflare.com" };
    });
    updateSettings.mockImplementation(async (next) => {
      if (next.tunnelUrl === "https://changed.trycloudflare.com") {
        throw persistenceError;
      }
      settings.current = { ...settings.current, ...next };
    });

    await enableTunnel(20128);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(onUrlUpdate("https://changed.trycloudflare.com")).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledWith("[Tunnel] url update error: database unavailable");
    } finally {
      warn.mockRestore();
    }
  });

  it("orders a retry after its canceled URL-update write", async () => {
    const stalePersist = deferred();
    let onUrlUpdate;
    spawnQuickTunnel
      .mockImplementationOnce(async (_port, callback) => {
        onUrlUpdate = callback;
        return { tunnelUrl: "https://initial.trycloudflare.com" };
      })
      .mockResolvedValueOnce({ tunnelUrl: "https://retry.trycloudflare.com" });
    updateSettings.mockImplementation((next) => {
      if (next.tunnelUrl === "https://stale.trycloudflare.com") {
        return stalePersist.promise.then(() => {
          settings.current = { ...settings.current, ...next };
        });
      }
      settings.current = { ...settings.current, ...next };
      return Promise.resolve();
    });

    await enableTunnel(20128);
    const staleCallback = onUrlUpdate("https://stale.trycloudflare.com");
    await vi.waitFor(() => expect(updateSettings).toHaveBeenCalledWith({
      tunnelEnabled: true,
      tunnelUrl: "https://stale.trycloudflare.com",
    }));

    const disabling = disableTunnel();
    const retry = enableTunnel(20128);
    await vi.waitFor(() => expect(spawnQuickTunnel).toHaveBeenCalledTimes(2));

    expect(updateSettings).not.toHaveBeenCalledWith({
      tunnelEnabled: true,
      tunnelUrl: "https://retry.trycloudflare.com",
    });

    stalePersist.resolve();
    await Promise.all([disabling, retry, staleCallback]);
    expect(settings.current).toEqual({
      tunnelEnabled: true,
      tunnelUrl: "https://retry.trycloudflare.com",
    });
  });

  it("does not let an already-started enabled write finish after disable", async () => {
    const persistEnabled = deferred();
    spawnQuickTunnel.mockResolvedValue({
      tunnelUrl: "https://race.trycloudflare.com",
    });
    updateSettings.mockImplementation((next) => {
      if (next.tunnelEnabled) {
        return persistEnabled.promise.then(() => {
          settings.current = { ...settings.current, ...next };
        });
      }
      settings.current = { ...settings.current, ...next };
      return Promise.resolve();
    });

    const enabling = enableTunnel(20128);
    await vi.waitFor(() => expect(updateSettings).toHaveBeenCalledWith({
      tunnelEnabled: true,
      tunnelUrl: "https://race.trycloudflare.com",
    }));
    const disabling = disableTunnel();
    persistEnabled.resolve();

    await disabling;
    await expect(enabling).rejects.toThrow("tunnel cancelled");
    expect(settings.current).toEqual({ tunnelEnabled: false, tunnelUrl: "" });
  });
});
