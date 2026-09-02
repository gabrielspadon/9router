import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const cli = readFileSync(new URL("../../cli/cli.js", import.meta.url), "utf8");

// Under systemd, launchd or a container there is no TTY. The launcher started
// the server, then blocked forever on an interactive menu prompt nothing could
// answer, so the unit never reached a steady state and the gateway looked hung
// while it was in fact already serving (#1191).
describe("the launcher does not wait on a prompt without a TTY (#1191)", () => {
  it("the menu loop is guarded by a TTY check", () => {
    const guard = cli.indexOf("if (!process.stdin.isTTY) {\n      console.log(`\\nTokenProxy is running at ${url}`);");
    const loop = cli.indexOf("const choice = await showInterfaceMenu(latestVersion);");
    expect(guard).toBeGreaterThan(0);
    // The guard must come BEFORE the loop; after it, it would never be reached.
    expect(guard).toBeLessThan(loop);
  });

  it("the tray still starts, because a detached desktop launch has no TTY either", () => {
    const tray = cli.lastIndexOf("initTrayIcon();");
    const guard = cli.indexOf("No TTY detected, so the interactive menu is disabled.");
    expect(tray).toBeGreaterThan(0);
    expect(tray).toBeLessThan(guard);
  });

  it("the pre-existing update-relaunch fallback is untouched", () => {
    expect(cli).toContain("if (skipUpdate && !trayMode && !process.stdin.isTTY) {");
  });
});

// Nothing could stop a gateway the launcher started except pkill (#967).
describe("tokenproxy stop (#967)", () => {
  it("dispatches on the subcommand and exits", () => {
    expect(cli).toContain('if (args[0] === "stop") {');
    expect(cli).toContain("killAllAppProcesses(port)");
    expect(cli).toContain("process.exit(0)");
  });

  it("runs after argument parsing so --port is honoured", () => {
    const parseEnd = cli.indexOf('} else if (args[i] === "--version" || args[i] === "-v") {');
    const stop = cli.indexOf('if (args[0] === "stop") {');
    expect(parseEnd).toBeGreaterThan(0);
    expect(stop).toBeGreaterThan(parseEnd);
  });

  it("runs before the server is started, so stop never spawns one", () => {
    const stop = cli.indexOf('if (args[0] === "stop") {');
    // No trailing semicolon in the match: the boot chain gained a terminal
    // .catch after this link (#974), so the statement no longer ends here.
    const start = cli.indexOf(".then(() => startServer(updatePromise))");
    expect(start).toBeGreaterThan(0);
    expect(stop).toBeLessThan(start);
  });

  it("is listed in --help", () => {
    expect(cli).toContain("stop                Stop a running gateway on this port and exit");
  });
});
