// Verify schema migration chain runs correctly across versions.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenproxy-mig-"));
  process.env.DATA_DIR = tempDir;
  // Reset global singleton so each test gets fresh adapter pointed at tempDir
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  // Close adapter to release file handles before rm
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("Schema migrations", () => {
  it("fresh DB → applies migrations & stamps schemaVersion", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const db = await getAdapter();
    const row = db.get(`SELECT value FROM _meta WHERE key='schemaVersion'`);
    expect(parseInt(row.value, 10)).toBe(latestVersion());

    const tables = db.all(`SELECT name FROM sqlite_master WHERE type='table'`).map(t => t.name);
    expect(tables).toEqual(expect.arrayContaining([
      "_meta", "settings", "providerConnections", "providerNodes",
      "proxyPools", "apiKeys", "combos", "kv", "usageHistory", "usageDaily", "requestDetails",
    ]));
  });

  it("existing DB at older schemaVersion → re-applies pending migrations on restart", async () => {
    // 1st boot
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, ['{"foo":"bar"}']);
    db.run(`UPDATE _meta SET value = '0' WHERE key = 'schemaVersion'`);
    db.close?.();

    // 2nd boot: full reset to simulate process restart
    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const db2 = await getAdapter2();
    const row = db2.get(`SELECT value FROM _meta WHERE key='schemaVersion'`);
    expect(parseInt(row.value, 10)).toBe(latestVersion());

    const settings = db2.get(`SELECT data FROM settings WHERE id=1`);
    expect(JSON.parse(settings.data)).toEqual({ foo: "bar" });
  });

  it("predecessor state sitting beside the namespace is neither read nor changed", async () => {
    // TokenProxy starts from a fresh install. A predecessor product's state
    // files are not an upgrade path: they are somebody else's data that happens
    // to share a home directory, and touching them at all is the defect.
    const predecessor = {
      "db.json": JSON.stringify({
        settings: { foo: "predecessor-value" },
        apiKeys: [{ id: "k1", key: "abc", name: "test", createdAt: new Date().toISOString() }],
        modelAliases: { "gpt-4": "gpt-4-turbo" },
      }),
      "usage.json": JSON.stringify({ history: [{ provider: "p", model: "m" }], totalRequestsLifetime: 7 }),
      "disabledModels.json": JSON.stringify({ disabled: { openai: ["gpt-4"] } }),
      "request-details.json": JSON.stringify({ records: [{ id: "r1", timestamp: new Date().toISOString() }] }),
    };
    for (const [name, body] of Object.entries(predecessor)) {
      fs.writeFileSync(path.join(tempDir, name), body);
    }
    const before = Object.keys(predecessor).map((name) => {
      const full = path.join(tempDir, name);
      return { name, body: fs.readFileSync(full, "utf-8"), mtimeMs: fs.statSync(full).mtimeMs };
    });

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();

    // Nothing was read: a clean install starts empty on every table the
    // predecessor files carry rows for.
    expect(db.get(`SELECT data FROM settings WHERE id=1`)).toBeFalsy();
    expect(db.all(`SELECT * FROM apiKeys`)).toHaveLength(0);
    expect(db.all(`SELECT * FROM kv`)).toHaveLength(0);
    expect(db.all(`SELECT * FROM usageHistory`)).toHaveLength(0);
    expect(db.all(`SELECT * FROM requestDetails`)).toHaveLength(0);
    expect(db.get(`SELECT value FROM _meta WHERE key='totalRequestsLifetime'`)).toBeFalsy();
    expect(db.get(`SELECT value FROM _meta WHERE key='migratedAt'`)).toBeFalsy();

    // Nothing was changed: same bytes, same mtime, and no marker or copy left
    // anywhere under the new namespace.
    for (const file of before) {
      const full = path.join(tempDir, file.name);
      expect(fs.readFileSync(full, "utf-8")).toBe(file.body);
      expect(fs.statSync(full).mtimeMs).toBe(file.mtimeMs);
    }
    const dbDir = path.join(tempDir, "db");
    expect(fs.existsSync(path.join(dbDir, ".migrated-from-json"))).toBe(false);
    const backupsDir = path.join(dbDir, "backups");
    const backups = fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir) : [];
    expect(backups).toHaveLength(0);
  });

  it("a foreign predecessor state directory is outside the search path entirely", async () => {
    // The predecessor kept its state in its own dot-directory. TokenProxy
    // resolves DATA_DIR and nothing else, so a sibling directory is invisible
    // whether or not it holds a database.
    const foreign = path.join(path.dirname(tempDir), `${path.basename(tempDir)}-predecessor`);
    fs.mkdirSync(path.join(foreign, "db"), { recursive: true });
    const foreignDb = path.join(foreign, "db", "data.sqlite");
    fs.writeFileSync(foreignDb, "not a real database");
    fs.writeFileSync(path.join(foreign, "db.json"), JSON.stringify({ settings: { foo: "foreign" } }));
    const foreignBefore = fs.readdirSync(foreign).sort();

    try {
      const { getAdapter } = await import("@/lib/db/driver.js");
      const db = await getAdapter();
      expect(db.all(`SELECT * FROM apiKeys`)).toHaveLength(0);
      expect(db.get(`SELECT data FROM settings WHERE id=1`)).toBeFalsy();

      expect(fs.readdirSync(foreign).sort()).toEqual(foreignBefore);
      expect(fs.readFileSync(foreignDb, "utf-8")).toBe("not a real database");

      // Every path the app resolves lives under DATA_DIR.
      const { DATA_FILE, DB_DIR, BACKUPS_DIR } = await import("@/lib/db/paths.js");
      for (const resolved of [DATA_FILE, DB_DIR, BACKUPS_DIR]) {
        expect(resolved.startsWith(tempDir + path.sep)).toBe(true);
      }
    } finally {
      fs.rmSync(foreign, { recursive: true, force: true });
    }
  });

  it("auto-sync re-creates missing index when DB lacks it", async () => {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    db.exec(`DROP INDEX IF EXISTS idx_pn_type`);
    expect(db.all(`PRAGMA index_list(providerNodes)`).map(i => i.name)).not.toContain("idx_pn_type");
    db.close?.();

    delete global._dbAdapter;
    vi.resetModules();
    const { getAdapter: getAdapter2 } = await import("@/lib/db/driver.js");
    const db2 = await getAdapter2();
    const idx = db2.all(`PRAGMA index_list(providerNodes)`).map(i => i.name);
    expect(idx).toContain("idx_pn_type");
  });
});
