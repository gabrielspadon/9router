import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const updater = read("src/lib/appUpdater.js");
const cli = read("cli/cli.js");

describe("the update relaunches the install it just updated (#2186)", () => {
  it("prefers the launcher's own path over resolving by name", () => {
    // After npm i -g the file at that path IS the new version, so relaunching
    // it is both the same install and the updated one.
    expect(updater).toContain("const own = process.env.TOKENPROXY_CLI_PATH;");
    expect(updater).toContain("return { cmd: process.execPath, args: [own] };");
  });

  it("only uses that path when it exists, so a stale value cannot strand the relaunch", () => {
    expect(updater).toContain("if (own && fs.existsSync(own))");
  });

  it("the launcher hands its path down", () => {
    expect(cli).toContain("TOKENPROXY_CLI_PATH: __filename");
  });

  it("the fallback refuses to fetch a version nobody installed", () => {
    // Without the flag a package runner may download one, which is a worse
    // failure than not relaunching.
    expect(updater).toContain('args: ["--no", UPDATER_CONFIG.npmPackageName]');
  });

  it("still passes the flags that preserve tray or foreground mode", () => {
    expect(updater).toContain('[...relaunch.args, "--tray", "--skip-update"]');
    expect(updater).toContain('[...relaunch.args, "--skip-update"]');
  });
});
