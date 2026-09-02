import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const script = new URL("../../docs/design/verification/instance.sh", import.meta.url).pathname;

describe("isolated instance seed source", () => {
  it("requires an explicit verified source instead of silently copying a stale default", () => {
    const missing = spawnSync("bash", [script, "seed-source"], { encoding: "utf8" });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain("TP_SEED_DATA_DIR");
  });

  it("accepts only an explicit directory containing the SQLite source", () => {
    const root = mkdtempSync(join(tmpdir(), "tokenproxy-seed-source-"));
    try {
      mkdirSync(join(root, "db"));
      writeFileSync(join(root, "db", "data.sqlite"), "fixture");
      const result = spawnSync("bash", [script, "seed-source"], {
        encoding: "utf8",
        env: { ...process.env, TP_SEED_DATA_DIR: root },
      });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
