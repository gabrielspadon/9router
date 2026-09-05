import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// P-F3: putWindows delete+reinserted every account's windows on every
// request inside the serialized selection queue. Now it compares the incoming
// windows against what is on disk and skips the transaction entirely when
// nothing that matters changed (observedAt is stamped per write by design and
// is therefore not part of the comparison).

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let repo;
let driver;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenproxy-pf3-"));
  process.env.DATA_DIR = tempDir;
  global._dbAdapter = { instance: null, initPromise: null, logged: false };
  vi.resetModules();
  const dbMod = await import("@/lib/db/index.js");
  await dbMod.initDb();
  repo = await import("@/lib/db/repos/quotaWindowsRepo.js");
  driver = await import("@/lib/db/driver.js");
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

// Records every statement while still executing it, so the post-write read
// sees the real table state.
function spyOnWrites(db, writes) {
  const origRun = db.run.bind(db);
  const spy = vi.spyOn(db, "run").mockImplementation((sql, params) => {
    writes.push(String(sql));
    return origRun(sql, params);
  });
  return spy;
}

const WINDOWS = [
  { scope: "session (5h)", remaining: 80, limit: 100, resetAt: "2026-09-04T18:00:00.000Z", confidence: "high" },
  { scope: "weekly (7d)", remaining: 62, limit: 100, resetAt: null, confidence: "unknown" },
];

describe("putWindows compare-and-skip (P-F3)", () => {
  it("writes once, then skips the write entirely when nothing changed", async () => {
    const db = await driver.getAdapter();
    await repo.putWindows("conn-pf3", WINDOWS);

    const writes = [];
    const spy = spyOnWrites(db, writes);
    // Fresh objects, same values — observedAt is caller-absent both times.
    const skipped = await repo.putWindows("conn-pf3", WINDOWS.map((w) => ({ ...w })));
    spy.mockRestore();

    expect(skipped).toBe(2); // contract: still reports the window count
    expect(writes.filter((sql) => /INSERT|DELETE/i.test(sql))).toHaveLength(0);
  });

  it("writes when a value actually changes", async () => {
    const db = await driver.getAdapter();
    const writes = [];
    const spy = spyOnWrites(db, writes);
    await repo.putWindows("conn-pf3", [{ ...WINDOWS[0], remaining: 79 }, WINDOWS[1]]);
    spy.mockRestore();

    expect(writes.some((sql) => /DELETE/i.test(sql))).toBe(true);
    expect(writes.filter((sql) => /INSERT/i.test(sql))).toHaveLength(2);
    const rows = await repo.getWindows("conn-pf3");
    expect(rows.find((r) => r.scope === "session (5h)")?.remaining).toBe(79);
  });

  it("writes when the window set shape changes (a scope disappears)", async () => {
    const db = await driver.getAdapter();
    const writes = [];
    const spy = spyOnWrites(db, writes);
    await repo.putWindows("conn-pf3", [WINDOWS[0]]);
    spy.mockRestore();
    expect(writes.some((sql) => /DELETE/i.test(sql))).toBe(true);
    expect(await repo.getWindows("conn-pf3")).toHaveLength(1);
  });

  it("writes when a previously empty table receives windows", async () => {
    const db = await driver.getAdapter();
    const writes = [];
    const spy = spyOnWrites(db, writes);
    await repo.putWindows("conn-pf3-new", WINDOWS);
    spy.mockRestore();
    expect(writes.filter((sql) => /INSERT/i.test(sql))).toHaveLength(2);
  });
});
