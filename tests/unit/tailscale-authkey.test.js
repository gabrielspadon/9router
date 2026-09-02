import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const mocks = vi.hoisted(() => {
  const exec = vi.fn();
  const execAsync = vi.fn();
  exec[Symbol.for("nodejs.util.promisify.custom")] = execAsync;
  return {
    exec,
    execAsync,
    execSync: vi.fn(),
    existsSync: vi.fn(),
    spawn: vi.fn(),
  };
});

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, exec: mocks.exec, execSync: mocks.execSync, spawn: mocks.spawn };
});

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: { ...(actual.default || {}), existsSync: mocks.existsSync },
    existsSync: mocks.existsSync,
  };
});

vi.mock("@/lib/dataDir.js", () => ({ DATA_DIR: "/tmp/tokenproxy-tailscale-authkey-test" }));

function makeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.unref = vi.fn();
  return child;
}

let tailscale;
let originalAuthKey;

beforeEach(async () => {
  originalAuthKey = process.env.TAILSCALE_AUTHKEY;
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.existsSync.mockReturnValue(true);
  mocks.execSync.mockImplementation((command) => {
    if (String(command).includes("status --json")) return "{}";
    throw new Error(`unexpected execSync: ${command}`);
  });
  mocks.spawn.mockImplementation(() => makeChild());
  mocks.execAsync.mockImplementation(async (command) => {
    if (String(command).includes("which tailscale")) return { stdout: "/fake/tailscale\n" };
    throw new Error(`unexpected exec: ${command}`);
  });
  vi.resetModules();
  tailscale = await import("../../src/lib/tunnel/tailscale/tailscale.js");
});

afterEach(() => {
  if (originalAuthKey === undefined) delete process.env.TAILSCALE_AUTHKEY;
  else process.env.TAILSCALE_AUTHKEY = originalAuthKey;
  vi.useRealTimers();
});

describe("tailscale auth-key login", () => {
  it("reads and trims TAILSCALE_AUTHKEY", () => {
    expect(tailscale.getTailscaleAuthKey({ TAILSCALE_AUTHKEY: " tskey-auth-test " }))
      .toBe("tskey-auth-test");
  });

  it("does not add an auth-key flag when the setting is blank", () => {
    expect(tailscale.buildTailscaleUpArgs("router-dev", { TAILSCALE_AUTHKEY: "  " }))
      .not.toEqual(expect.arrayContaining([expect.stringMatching(/^--auth-key=/)]));
  });

  it("passes the auth key and resolves after the custom socket reports login", async () => {
    process.env.TAILSCALE_AUTHKEY = "tskey-auth-test";
    let customProbeCount = 0;
    mocks.execAsync.mockImplementation(async (command) => {
      if (String(command).includes("which tailscale")) return { stdout: "/fake/tailscale\n" };
      if (String(command).includes("/tmp/tokenproxy-tailscale-authkey-test/tailscale/tailscaled.sock")) {
        customProbeCount += 1;
        return {
          stdout: JSON.stringify(customProbeCount === 1
            ? { BackendState: "NeedsLogin", Self: { Online: false } }
            : { BackendState: "Running", Self: { Online: true } }),
        };
      }
      throw new Error(`unexpected exec: ${command}`);
    });

    const login = tailscale.startLogin("router-dev");
    let settled = false;
    void login.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(500);

    expect(settled).toBe(true);
    await expect(login).resolves.toEqual({ alreadyLoggedIn: true });
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.stringContaining("/bin/tailscale"),
      expect.arrayContaining([
        "up",
        "--accept-routes",
        "--hostname=router-dev",
        "--auth-key=tskey-auth-test",
      ]),
      expect.objectContaining({ detached: true }),
    );
  });

  it("does not accept system-socket login as custom auth-key completion", async () => {
    mocks.execAsync.mockImplementation(async (command) => {
      const text = String(command);
      if (text.includes("which tailscale")) return { stdout: "/fake/tailscale\n" };
      if (text.includes("/tmp/tokenproxy-tailscale-authkey-test/tailscale/tailscaled.sock")) {
        throw new Error("custom socket is not logged in");
      }
      if (text.includes("/var/run/tailscale/tailscaled.sock")) {
        return { stdout: JSON.stringify({ BackendState: "Running", Self: { Online: true } }) };
      }
      throw new Error(`unexpected exec: ${command}`);
    });

    const login = tailscale.startLogin("router-dev");
    let settled = false;
    void login.then(() => { settled = true; }, () => { settled = true; });
    await vi.advanceTimersByTimeAsync(500);

    expect(settled).toBe(false);
  });
});
