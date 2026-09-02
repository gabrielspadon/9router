import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// #1284: on macOS, Hide to Tray only ignored SIGHUP and otherwise kept the
// terminal-owned process alive, so the global SIGTERM handler registered at
// startup still tore the "backgrounded" server down the moment a session or
// process manager sent SIGTERM -- a false-background state, exactly as
// reported (terminal says "you can close this", but a stronger-than-SIGHUP
// signal still kills the server). cli.js runs a lot of startup side effects,
// so this follows the same source-slicing approach as the existing
// autostart-opt-out-3628 test rather than executing the file directly.
const cli = readFileSync(new URL("../../cli/cli.js", import.meta.url), "utf8");

describe("Hide to Tray on macOS survives more than SIGHUP (#1284)", () => {
  function darwinHideBlock() {
    const hide = cli.slice(cli.indexOf("Enable auto startup only"));
    const darwin = hide.slice(hide.indexOf('process.platform === "darwin"'));
    return darwin.slice(0, darwin.indexOf("Tray already init'd"));
  }

  it("ignores SIGHUP, same as before", () => {
    const block = darwinHideBlock();
    expect(block).toContain('process.removeAllListeners("SIGHUP")');
    expect(block).toContain('process.on("SIGHUP", () => {});');
  });

  it("also ignores SIGTERM so a session/process manager cannot kill the hidden server", () => {
    const block = darwinHideBlock();
    expect(block).toContain('process.removeAllListeners("SIGTERM")');
    expect(block).toContain('process.on("SIGTERM", () => {});');
  });

  it("registers the SIGTERM override in the same darwin branch as SIGHUP, not globally", () => {
    // The blanket startup SIGTERM handler (which does call cleanup()+exit)
    // must stay intact for every other code path -- only the macOS hide
    // branch overrides it, mirroring how it already overrides SIGHUP there
    // without touching the global SIGHUP handler used elsewhere.
    const globalHandlerCount = (cli.match(/process\.on\("SIGTERM", \(\) => \{\s*\n\s*if \(isShuttingDown\)/g) || []).length;
    expect(globalHandlerCount).toBe(1);

    const block = darwinHideBlock();
    const hupIndex = block.indexOf('process.on("SIGHUP", () => {});');
    const termIndex = block.indexOf('process.on("SIGTERM", () => {});');
    expect(hupIndex).toBeGreaterThan(-1);
    expect(termIndex).toBeGreaterThan(hupIndex);
  });
});
