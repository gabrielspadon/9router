import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../src/mitm/manager.js", import.meta.url), "utf8");

// `.killed` reports only that WE signalled the child. A process that died on its
// own leaves a non-null handle with killed false, so startServer threw "already
// running" for a process that was not, and the state never cleared itself if the
// exit event was missed.
describe("a dead MITM process does not block restart (#1462)", () => {
  it("asks the OS whether the pid is alive", () => {
    expect(src).toContain("isProcessAlive(serverProcess.pid)");
    expect(src).toContain("process.kill(pid, 0)");
    // One helper, not a second one shadowing the first.
    expect((src.match(/function isProcessAlive\(/g) || []).length).toBe(1);
  });

  it("treats EPERM as alive, since the process exists", () => {
    const fn = src.slice(src.indexOf("function isProcessAlive"));
    // A process owned by another user is still alive; Node reports that as
    // EPERM, which the original helper missed by checking EACCES alone.
    expect(fn.slice(0, fn.indexOf("\n}\n"))).toContain('EPERM');
    expect(fn.slice(0, fn.indexOf("\n}\n"))).toContain('EACCES');
  });

  it("clears a stale handle instead of waiting for an exit event", () => {
    const guard = src.slice(src.indexOf("if (serverProcess && !serverProcess.killed && isProcessAlive"));
    const after = guard.slice(0, guard.indexOf("// Ensure the MITM state dir"));
    expect(after).toContain("serverProcess = null");
    expect(after).toContain("serverPid = null");
  });

  it("still refuses when the process really is running", () => {
    // The guard keeps all three conditions; dropping killed would let a
    // deliberate shutdown-in-progress be treated as restartable.
    expect(src).toContain("serverProcess && !serverProcess.killed && isProcessAlive(serverProcess.pid)");
  });

  it("the liveness predicate distinguishes a live pid from a dead one", () => {
    // Deterministic: this process is certainly alive, pid 0 is not a process,
    // and a pid above the kernel maximum cannot exist. Spawning and killing a
    // child would be testing Node's reaping timing rather than this predicate.
    const alive = (pid) => {
      if (!pid) return false;
      try { process.kill(pid, 0); return true; }
      catch (e) { return e?.code === "EPERM" || e?.code === "EACCES"; }
    };
    expect(alive(process.pid)).toBe(true);
    expect(alive(0)).toBe(false);
    expect(alive(null)).toBe(false);
    expect(alive(undefined)).toBe(false);
    expect(alive(0x7fffffff)).toBe(false);
  });
});
