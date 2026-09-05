import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// P-F1: decrypted connection rows are cached per raw-row fingerprint, so a
// request-path read skips the per-row AES-GCM decrypt. Any write to any
// column changes the fingerprint and busts the cache; writers in OTHER repos
// (proxy-pool snapshot, node delete) are covered because they too change the
// row. These tests prove both directions: repeated reads hit the cache, and
// every write path (this repo, and a foreign direct-DB write) invalidates it.

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let repo;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenproxy-pf1-conn-"));
  process.env.DATA_DIR = tempDir;
  global._dbAdapter = { instance: null, initPromise: null, logged: false };
  vi.resetModules();
  const dbMod = await import("@/lib/db/index.js");
  await dbMod.initDb();
  repo = await import("@/lib/db/repos/connectionsRepo.js");
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("connections row decrypt cache (P-F1)", () => {
  it("serves repeated reads from the cache", async () => {
    const conn = await repo.createProviderConnection({
      provider: "claude", authType: "apikey", name: "pf1-a", apiKey: "sk-pf1",
    });
    const before = repo._connectionsCacheStats();
    await repo.getProviderConnectionById(conn.id); // miss, warms
    await repo.getProviderConnectionById(conn.id); // hit
    const after = repo._connectionsCacheStats();
    expect(after.misses).toBe(before.misses + 1);
    expect(after.hits).toBe(before.hits + 1);
    const list = await repo.getProviderConnections({ provider: "claude" });
    expect(list.some((c) => c.id === conn.id)).toBe(true);
  });

  it("a repo write path busts the cache", async () => {
    const conn = await repo.createProviderConnection({
      provider: "claude", authType: "apikey", name: "pf1-b", apiKey: "sk-pf1b",
    });
    await repo.getProviderConnectionById(conn.id); // warm
    await repo.updateProviderConnection(conn.id, { apiKey: "sk-pf1b-v2" });
    const reread = await repo.getProviderConnectionById(conn.id);
    expect(reread.apiKey).toBe("sk-pf1b-v2");
  });

  it("a foreign direct-DB write busts the cache too", async () => {
    const conn = await repo.createProviderConnection({
      provider: "claude", authType: "apikey", name: "pf1-c", apiKey: "sk-pf1c",
    });
    await repo.getProviderConnectionById(conn.id); // warm
    // Simulate proxyPoolsRepo.js's direct data-column write: no repo function
    // runs, but the row the next read SELECTs differs, so the fingerprint
    // must miss.
    const db = await (await import("@/lib/db/driver.js")).getAdapter();
    db.run(`UPDATE providerConnections SET name = ? WHERE id = ?`, ["pf1-c-renamed", conn.id]);
    const reread = await repo.getProviderConnectionById(conn.id);
    expect(reread.name).toBe("pf1-c-renamed");
  });

  it("sees a delete immediately (no resurrected cached row)", async () => {
    const conn = await repo.createProviderConnection({
      provider: "claude", authType: "apikey", name: "pf1-d", apiKey: "sk-pf1d",
    });
    await repo.getProviderConnectionById(conn.id); // warm
    await repo.deleteProviderConnection(conn.id);
    expect(await repo.getProviderConnectionById(conn.id)).toBeNull();
  });
});
