// #987: "[DB] No SQLite driver available (bun/better/node/sql.js all failed)".
// The reporter could not act on that line because it named no cause for any
// link. These lock the failure to one that does, and keep the chain returning
// an adapter as soon as any link works.
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenproxy-driver-987-"));
process.env.DATA_DIR = tmpDataDir;

const bunFail = vi.fn(() => { throw new Error("bun boom"); });
const betterFail = vi.fn(() => { throw new Error("Cannot find module 'better-sqlite3'"); });
const nodeFail = vi.fn(() => { throw new Error("node boom"); });
const sqljs = vi.fn(() => { throw new Error("ENOENT: no such file or directory, open '/app/node_modules/sql.js/dist/sql-wasm.wasm'"); });

vi.mock("@/lib/db/adapters/bunSqliteAdapter.js", () => ({ createBunSqliteAdapter: (...a) => bunFail(...a) }));
vi.mock("@/lib/db/adapters/betterSqliteAdapter.js", () => ({ createBetterSqliteAdapter: (...a) => betterFail(...a) }));
vi.mock("@/lib/db/adapters/nodeSqliteAdapter.js", () => ({ createNodeSqliteAdapter: (...a) => nodeFail(...a) }));
vi.mock("@/lib/db/adapters/sqljsAdapter.js", () => ({ createSqlJsAdapter: (...a) => sqljs(...a) }));
vi.mock("@/lib/db/migrate.js", () => ({ runMigrationOnce: vi.fn(async () => {}) }));

async function loadDriver() {
  vi.resetModules();
  global._dbAdapter = { instance: null, initPromise: null, logged: false };
  return import("@/lib/db/driver.js");
}

describe("#987 SQLite driver chain", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    sqljs.mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory, open '/app/node_modules/sql.js/dist/sql-wasm.wasm'");
    });
  });

  it("names a reason for every link, not just that all of them failed", async () => {
    const { getAdapter } = await loadDriver();
    const err = await getAdapter().then(() => null, (e) => e);
    expect(err).toBeInstanceOf(Error);

    // One labelled line per candidate, in chain order.
    for (const driver of ["bun:sqlite", "better-sqlite3", "node:sqlite", "sql.js"]) {
      expect(err.message).toContain(`- ${driver}:`);
    }
    // And the reason next to each, rather than a bare list of names.
    expect(err.message).toContain("Cannot find module 'better-sqlite3'");
    expect(err.message).toMatch(/bun:sqlite: (not running under Bun|bun boom)/);
  });

  it("says the packaged build is missing sql.js's WASM binary when that is what broke", async () => {
    const { getAdapter } = await loadDriver();
    const err = await getAdapter().then(() => null, (e) => e);
    // ENOENT on sql-wasm.wasm reads as "sql.js is broken"; it is the build not
    // shipping the file the loader reads at runtime. Say so at the failure.
    expect(err.message).toContain("sql-wasm.wasm");
    expect(err.message).toContain("without its WASM binary");
  });

  it("still returns an adapter when a later link works", async () => {
    sqljs.mockImplementation(() => ({ driver: "sql.js", run() {}, get() {}, all: () => [], exec() {}, transaction: (f) => f(), close() {} }));
    const { getAdapter } = await loadDriver();
    const adapter = await getAdapter();
    expect(adapter.driver).toBe("sql.js");
  });
});
