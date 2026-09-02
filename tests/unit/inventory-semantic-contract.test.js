import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const repo = new URL("../..", import.meta.url).pathname;
const checker = new URL("../../docs/design/verification/check-inventory.mjs", import.meta.url).pathname;

function inventory(control, provenance = {}) {
  return {
    mode: "fixture",
    total: 1,
    routes: { usage: { path: "/dashboard/usage", controls: [control] } },
    pageErrors: [],
    provenance,
  };
}

describe("inventory semantic capability contract", () => {
  it("accepts a provider link whose live status label changed but target stayed reachable", () => {
    const dir = mkdtempSync(join(tmpdir(), "tokenproxy-inventory-live-label-"));
    try {
      const before = join(dir, "before.json");
      const after = join(dir, "after.json");
      writeFileSync(before, JSON.stringify(inventory({
        role: "link", name: "Antigravity 2 Connected", dest: "/dashboard/providers/antigravity", depth: 0,
        key: "link|Antigravity 2 Connected|/dashboard/providers/antigravity",
      }, { seedDigest: "seed", sourceRevision: "before", buildId: "build-before" })));
      writeFileSync(after, JSON.stringify(inventory({
        role: "link", name: "Antigravity 2 Token expired", dest: "/dashboard/providers/antigravity", depth: 0,
        key: "link|Antigravity 2 Token expired|/dashboard/providers/antigravity",
      }, { seedDigest: "seed", sourceRevision: "after", buildId: "build-after" })));

      const result = spawnSync(process.execPath, [checker, "--before-file", before, "--after-file", after], {
        cwd: repo,
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("INVENTORY OK");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not accept an inert button as a relocated named link", () => {
    const dir = mkdtempSync(join(tmpdir(), "tokenproxy-inventory-semantic-"));
    try {
      const before = join(dir, "before.json");
      const after = join(dir, "after.json");
      writeFileSync(before, JSON.stringify(inventory({
        role: "link", name: "Save", dest: "/dashboard/endpoint", depth: 0,
        key: "link|Save|/dashboard/endpoint",
      })));
      writeFileSync(after, JSON.stringify(inventory({
        role: "button", name: "Save", dest: "", depth: 0,
        key: "button|Save|",
      })));

      const result = spawnSync(process.execPath, [checker, "--before-file", before, "--after-file", after], {
        cwd: repo,
        encoding: "utf8",
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("unreachable: 1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects comparison captures made from different data seeds", () => {
    const dir = mkdtempSync(join(tmpdir(), "tokenproxy-inventory-provenance-"));
    try {
      const before = join(dir, "before.json");
      const after = join(dir, "after.json");
      const control = { role: "button", name: "Save", dest: "", depth: 0, key: "button|Save|" };
      writeFileSync(before, JSON.stringify(inventory(control, {
        seedDigest: "seed-a", sourceRevision: "base", buildId: "build-a",
      })));
      writeFileSync(after, JSON.stringify(inventory(control, {
        seedDigest: "seed-b", sourceRevision: "after", buildId: "build-b",
      })));

      const result = spawnSync(process.execPath, [checker, "--before-file", before, "--after-file", after], {
        cwd: repo,
        encoding: "utf8",
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain("seed digest differs");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
