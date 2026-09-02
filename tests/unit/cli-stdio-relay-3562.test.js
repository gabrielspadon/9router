import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const src = readFileSync(new URL("../../cli/cli.js", import.meta.url), "utf8");
const spawnServer = src.slice(src.indexOf("function spawnServer()"), src.indexOf("let server = spawnServer();"));

// Handing the server child an interactive Windows console handle makes it spin
// at 100% of a core and serve nothing (#3562); a file or pipe handle is fine.
// The mirror failure is an UNCONSUMED pipe, which freezes the server instead
// (#2447). So: always pipe, and always drain what is piped.
describe("the server child never inherits a console handle (#3562)", () => {
  it("does not use inherit", () => {
    expect(spawnServer).not.toContain('"inherit"');
    expect(spawnServer).toContain('stdio: ["ignore", "pipe", "pipe"]');
  });

  it("drains stdout whenever it is piped", () => {
    // stdout is piped unconditionally now (#1753), so the reader must be too:
    // a piped stream nobody drains is exactly the #2447 freeze.
    expect(spawnServer).toContain("if (child.stdout) {");
    expect(spawnServer).not.toContain("if (showLog && child.stdout)");
    expect(spawnServer).toContain("process.stdout.write(data)");
  });

  it("drains stderr unconditionally, since it is always piped", () => {
    expect(spawnServer).toContain("if (child.stderr) {");
    expect(spawnServer).toContain("pushCrashLog(data)");
  });

  it("keeps the crash tail even while --log is on", () => {
    // Previously the tail was collected only when logs were hidden, so a crash
    // during --log left no captured context.
    expect(spawnServer).not.toContain("if (!showLog && child.stderr)");
  });

  it("a piped, relayed child actually delivers its output", async () => {
    // The behavioural half: prove the stdio shape the CLI now uses does carry
    // the child's stdout to a listener, rather than only asserting on source.
    const out = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["-e", "process.stdout.write('READY'); process.stderr.write('WARN')"],
        { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.stdout.on("data", (d) => { stdout += d; });
      child.stderr.on("data", (d) => { stderr += d; });
      child.on("error", reject);
      child.on("close", () => resolve({ stdout, stderr }));
    });
    expect(out.stdout).toBe("READY");
    expect(out.stderr).toBe("WARN");
  });
});
