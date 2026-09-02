import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const detect = readFileSync(new URL("../../src/lib/headroom/detect.js", import.meta.url), "utf8");

// A version manager like mise puts its shims on PATH from an interactive shell
// only, so a server started by a service manager saw neither the shims nor the
// interpreter behind them: headroom reported "no Python >= 3.10" on a machine
// whose own `python --version` says 3.12 (#2353).
describe("headroom finds a version-manager Python (#2353)", () => {
  it("the mise shim directory is probed", () => {
    expect(detect).toContain("/.local/share/mise/shims");
  });

  it("sibling managers with the same shape are covered", () => {
    expect(detect).toContain("/.pyenv/shims");
    expect(detect).toContain("/.asdf/shims");
  });

  it("they sit on the POSIX branch, between two POSIX-only entries", () => {
    // .local/bin and /usr/bin appear only in the non-Windows arm of EXTRA_BINS,
    // so landing between them places the shims there without parsing the ternary.
    const localBin = detect.indexOf("/.local/bin`");
    const usrBin = detect.indexOf('"/usr/bin"');
    const shims = detect.indexOf("mise/shims");
    expect(localBin).toBeGreaterThan(0);
    expect(shims).toBeGreaterThan(localBin);
    expect(shims).toBeLessThan(usrBin);
  });

  it("shim dirs come before /usr/bin, so a managed interpreter wins over the system one", () => {
    // Order is the point: /usr/bin/python3 may exist and be too old, and the
    // scan takes the first version-eligible candidate as its fallback.
    expect(detect.indexOf("mise/shims")).toBeLessThan(detect.indexOf('"/usr/bin"'));
  });

  it("the shim resolves with no manager activated, which is why this works", () => {
    // Only meaningful where mise is actually installed; elsewhere the point is
    // carried by the assertions above.
    const shim = path.join(process.env.HOME || "", ".local/share/mise/shims/python");
    if (!existsSync(shim)) return;
    const out = execFileSync(shim, ["--version"], {
      env: { HOME: process.env.HOME },
      encoding: "utf8",
    });
    expect(out).toMatch(/^Python \d+\.\d+/);
  });
});
