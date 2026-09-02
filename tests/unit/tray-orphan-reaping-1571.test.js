import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../cli/src/cli/tray/tray.js", import.meta.url), "utf8");

// The Go tray binary is a child of the Node process and killTray() only runs on
// a graceful exit, so a SIGKILL or a crash left it in the panel forever and the
// next start added another icon beside it (#1571).
describe("an orphaned tray binary is reaped before a new one spawns (#1571)", () => {
  it("the pid is recorded when the tray starts", () => {
    expect(src).toContain("function recordTrayPid(instance)");
    expect(src).toContain("recordTrayPid(trayInstance);");
  });

  it("a survivor is reaped before the new instance is created", () => {
    const reap = src.indexOf("reapOrphanTray();");
    const spawn = src.indexOf("trayInstance = new SysTray(");
    expect(reap).toBeGreaterThan(0);
    expect(reap).toBeLessThan(spawn);
  });

  it("the pid file is removed once the tray really exits", () => {
    // Otherwise the next start reaps a pid that is already gone, and if that
    // number has been reused it belongs to something else.
    const finish = src.slice(src.indexOf("const finish = () =>"), src.indexOf("proc.once(\"exit\", finish)"));
    expect(finish).toContain("unlinkSync(file)");
  });

  it("the process identity is verified before any signal is sent", () => {
    // This is the load-bearing safety property: a pid file outlives its process
    // and the number gets reused, so killing on the pid alone could take out an
    // unrelated process.
    expect(src).toContain("function isTrayProcess(pid)");
    expect(src).toContain("isTrayProcess(pid)");
    const reap = src.slice(src.indexOf("function reapOrphanTray"), src.indexOf("function recordTrayPid"));
    expect(reap.indexOf("isTrayProcess(pid)")).toBeLessThan(reap.indexOf("process.kill(pid"));
  });

  it("it checks the binary name, per platform", () => {
    expect(src).toContain('process.platform === "darwin" ? "tray_darwin_release" : "tray_linux_release"');
    expect(src).toContain("/proc/${pid}/cmdline");
  });

  it("it never signals its own pid", () => {
    expect(src).toContain("pid !== process.pid");
  });

  it("SIGTERM, not SIGKILL", () => {
    // A killed Go binary can leave a ghost icon; a clean quit releases it.
    const reap = src.slice(src.indexOf("function reapOrphanTray"), src.indexOf("function recordTrayPid"));
    expect(reap).toContain('"SIGTERM"');
    expect(reap).not.toContain('"SIGKILL"');
  });
});
