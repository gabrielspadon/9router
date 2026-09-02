// Issue #1753: running the server in the background produced no output to look
// at. The child was spawned with stdout "ignore" unless --log was passed, so a
// slow or failing boot left nothing behind. stderr was already relayed AND kept
// in the crash tail; stdout now goes through the same path. cli.js is a
// top-level script that starts a server on import, so it is read, not run.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const cli = readFileSync(new URL("../../cli/cli.js", import.meta.url), "utf8");
const spawnBlock = cli.slice(cli.indexOf("function spawnServer()"), cli.indexOf("let server = spawnServer()"));

describe("background server stdout reaches the crash log (#1753)", () => {
  it("stdout is always piped, never discarded", () => {
    expect(spawnBlock).toContain('stdio: ["ignore", "pipe", "pipe"]');
    expect(spawnBlock).not.toContain('showLog ? "pipe" : "ignore"');
  });

  it("the pipe is drained whether or not --log is on (#2447 still holds)", () => {
    // A piped stdout with no reader fills and freezes the server, so the
    // handler must be attached unconditionally — not behind `showLog &&`.
    expect(spawnBlock).toContain("if (child.stdout) {");
    expect(spawnBlock).not.toContain("if (showLog && child.stdout)");
    expect(spawnBlock).toMatch(/child\.stdout\.on\("data"/);
  });

  it("stdout and stderr keep the same tail, and relay only with --log", () => {
    const bothPush = spawnBlock.match(/pushCrashLog\(data\)/g) || [];
    expect(bothPush).toHaveLength(2);
    expect(spawnBlock).toContain('if (showLog) { try { process.stdout.write(data); } catch { } }');
    expect(spawnBlock).toContain('if (showLog) { try { process.stderr.write(data); } catch { } }');
  });

  it("the tail stays bounded by the existing limit", () => {
    const tail = cli.slice(cli.indexOf("function pushCrashLog"), cli.indexOf("function spawnServer()"));
    expect(tail).toContain("crashLog.length > CRASH_LOG_LINES");
    expect(tail).toContain("crashLog.slice(-CRASH_LOG_LINES)");
    expect(cli).toContain("const CRASH_LOG_LINES = 50;");
  });

  it("the crash tail is still what gets printed on exit", () => {
    expect(cli).toMatch(/if \(crashLog\.length\) \{/);
    expect(cli).toContain("crashLog.forEach(l => console.error(l));");
  });
});
