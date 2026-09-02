import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createSqlJsAdapter } from "../../src/lib/db/adapters/sqljsAdapter.js";

let tempDir, dbPath;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sqljs-persist-"));
  dbPath = path.join(tempDir, "data.sqlite");
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("sqljs atomic persist", () => {
  it("writes the database file on close after writes", async () => {
    const adapter = await createSqlJsAdapter(dbPath);
    adapter.run("CREATE TABLE t (v TEXT)");
    adapter.run("INSERT INTO t (v) VALUES (?)", ["hello"]);
    adapter.close();
    expect(fs.existsSync(dbPath)).toBe(true);
    const reopen = await createSqlJsAdapter(dbPath);
    expect(reopen.get("SELECT v FROM t").v).toBe("hello");
    reopen.close();
  });

  it("leaves no .tmp file behind after a successful persist", async () => {
    const adapter = await createSqlJsAdapter(dbPath);
    adapter.exec("CREATE TABLE t (v INTEGER)");
    adapter.close();
    expect(fs.existsSync(dbPath + ".tmp")).toBe(false);
  });

  it("keeps the previous file intact when the persist write fails", async () => {
    const adapter = await createSqlJsAdapter(dbPath);
    adapter.run("CREATE TABLE t (v TEXT)");
    adapter.run("INSERT INTO t (v) VALUES (?)", ["old"]);
    adapter.close();
    const oldBytes = fs.readFileSync(dbPath);

    // ponytail: simulate the ENOSPC/EIO failure by a read-only directory;
    // the real failure modes hit the same open/write/fsync path.
    const next = await createSqlJsAdapter(dbPath);
    next.run("INSERT INTO t (v) VALUES (?)", ["new"]);
    fs.chmodSync(tempDir, 0o555);
    expect(() => next.close()).toThrow(/EACCES/); // persist surfaces the failure, db stays in memory
    fs.chmodSync(tempDir, 0o755);

    expect(fs.readFileSync(dbPath).equals(oldBytes)).toBe(true);
  });

  it("removes a stale .tmp left by a crashed prior run", async () => {
    fs.writeFileSync(dbPath + ".tmp", "garbage");
    const adapter = await createSqlJsAdapter(dbPath);
    adapter.exec("CREATE TABLE t (v INTEGER)");
    adapter.close();
    expect(fs.readFileSync(dbPath).length).toBeGreaterThan(0);
    expect(fs.existsSync(dbPath + ".tmp")).toBe(false);
  });
});
