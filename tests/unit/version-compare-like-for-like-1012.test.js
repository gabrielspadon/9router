import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { UPDATER_CONFIG } from "@/shared/constants/config";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const route = read("../../src/app/api/version/route.js");
const cli = read("../../cli/cli.js");
const appPkg = JSON.parse(read("../../package.json"));
const cliPkg = JSON.parse(read("../../cli/package.json"));

// The update banner fetches the npm `latest` of the CLI package "tokenproxy" and
// compared it against the bundled "tokenproxy-app" version. The two are released
// independently, so the comparison had a different package on each side (#1012).
describe("the update check compares the same package on both sides (#1012)", () => {
  it("the two packages really are distinct and independently versioned", () => {
    // The premise. If they were one package the bug would not exist.
    expect(appPkg.name).toBe("tokenproxy-app");
    expect(cliPkg.name).toBe("tokenproxy");
    // The route no longer repeats the name; it reads the one the updater
    // installs from, so a fork retargets a single constant (#1563).
    expect(route).toContain("const NPM_PACKAGE_NAME = UPDATER_CONFIG.npmPackageName;");
    expect(UPDATER_CONFIG.npmPackageName).toBe(cliPkg.name);
  });

  it("the route prefers the launcher's version", () => {
    expect(route).toContain("process.env.TOKENPROXY_CLI_VERSION || pkg.version");
  });

  it("the launcher passes its own version to the server", () => {
    const i = cli.indexOf("TOKENPROXY_CLI_VERSION: pkg.version");
    expect(i).toBeGreaterThan(0);
    // It has to be in the spawn env, not somewhere decorative.
    const spawnEnv = cli.slice(cli.lastIndexOf("env: {", i), i + 60);
    expect(spawnEnv).toContain("PORT: port.toString()");
  });

  it("a server started without the launcher still reports something", () => {
    // The fallback keeps /api/version answering for a bare `next start`.
    expect(route).toContain("|| pkg.version");
  });

  it("the comparison direction is unchanged", () => {
    expect(route).toContain("compareVersions(latestVersion, currentVersion) > 0");
  });
});
