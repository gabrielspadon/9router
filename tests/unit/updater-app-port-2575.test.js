import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn(() => ({ unref: vi.fn() })) }));

vi.mock("child_process", () => ({
  spawn: mocks.spawn,
  execSync: vi.fn(),
}));

const { spawnUpdaterAndExit } = await import("../../src/lib/appUpdater.js");
const { UPDATER_CONFIG } = await import("../../src/shared/constants/config.js");

function spawnedEnv() {
  expect(mocks.spawn).toHaveBeenCalledTimes(1);
  return mocks.spawn.mock.calls[0][2].env;
}

// The updater polls this port to decide the old server has exited and its file
// locks are released, then opens the dashboard on it after the relaunch
// (src/lib/updater/updater.js). Reading a compile-time default instead of the
// live port made both wrong on any install that is not on 20128: the poll sees
// a free port immediately and installs under the still-running server (#2575).
describe("#2575 the updater waits on the port this server is actually serving", () => {
  let priorPort;
  let priorPortPresent;
  let exitSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    priorPortPresent = Object.prototype.hasOwnProperty.call(process.env, "PORT");
    priorPort = process.env.PORT;
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    exitSpy.mockRestore();
    if (priorPortPresent) process.env.PORT = priorPort;
    else delete process.env.PORT;
  });

  it("hands the live PORT down to the detached updater", () => {
    process.env.PORT = "20222";
    spawnUpdaterAndExit();
    expect(spawnedEnv().UPDATER_APP_PORT).toBe("20222");
  });

  it("falls back to the configured default when PORT is unset", () => {
    delete process.env.PORT;
    spawnUpdaterAndExit();
    expect(spawnedEnv().UPDATER_APP_PORT).toBe(String(UPDATER_CONFIG.appPort));
  });

  it("leaves the updater's own status port alone", () => {
    process.env.PORT = "20222";
    spawnUpdaterAndExit();
    expect(spawnedEnv().UPDATER_PORT).toBe(String(UPDATER_CONFIG.statusPort));
  });
});
