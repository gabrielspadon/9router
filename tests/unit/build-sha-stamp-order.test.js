// THE STAMP HAS TO LAND BEFORE THE NEXT BUILD.
//
// next.config.mjs resolves TP_BUILD_SHA by reading cli/BUILD_SHA and webpack
// inlines it into the bundle, so /api/version and the sidebar report whatever
// that file said at Next-build time. build-cli.js used to write it in step 9,
// after step 1's `npm run build`, which meant every pack shipped the PREVIOUS
// pack's sha in the UI while the package root carried the current one. Observed
// live: package root ee2630d1, /api/version d695ba6e, one release apart.
//
// The coupling is between two files, so the test is on both.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const buildCli = read("../../cli/scripts/build-cli.js");
const nextConfig = read("../../next.config.mjs");

describe("BUILD_SHA is stamped before the bundle is built", () => {
  it("next.config.mjs is what makes the ordering matter", () => {
    // If this stops being true the ordering constraint is gone and this whole
    // suite is obsolete rather than failing.
    expect(nextConfig).toContain('join(projectRoot, "cli", "BUILD_SHA")');
    expect(nextConfig).toContain("TP_BUILD_SHA: tpBuildSha");
  });

  it("writes cli/BUILD_SHA before it invokes the Next build", () => {
    const stamp = buildCli.indexOf('fs.writeFileSync(path.join(cliDir, "BUILD_SHA")');
    const nextBuild = buildCli.indexOf('execSync("npm run build"');
    expect(stamp).toBeGreaterThan(-1);
    expect(nextBuild).toBeGreaterThan(-1);
    expect(stamp).toBeLessThan(nextBuild);
  });

  it("still removes the file rather than writing a placeholder off a checkout", () => {
    // An absent stamp is a true "provenance unknown". A filler sha would be
    // baked into the bundle and read as real.
    expect(buildCli).toContain('fs.rmSync(path.join(cliDir, "BUILD_SHA"), { force: true })');
    expect(buildCli).not.toMatch(/BUILD_SHA[\s\S]{0,200}"unknown"/);
  });

  it("git HEAD wins over the stamp files when a .git dir exists (worktree freshness)", () => {
    // The stamp files are the standalone/no-git fallback; in a checkout they
    // go stale, so rev-parse must run first and the file reads second.
    const gitTry = nextConfig.indexOf('existsSync(join(projectRoot, ".git"))');
    const fileRead = nextConfig.indexOf('join(projectRoot, "cli", "BUILD_SHA")');
    expect(gitTry).toBeGreaterThan(-1);
    expect(fileRead).toBeGreaterThan(-1);
    expect(gitTry).toBeLessThan(fileRead);
  });

  it("slices an env-provided sha to 12 chars like every other path", () => {
    expect(nextConfig).toContain("process.env.TOKENPROXY_BUILD_SHA.slice(0, 12)");
  });

  it("stamps exactly once, so no later write can shadow the pre-build one", () => {
    const writes = buildCli.match(/writeFileSync\(path\.join\(cliDir, "BUILD_SHA"\)/g) || [];
    expect(writes).toHaveLength(1);
  });
});
