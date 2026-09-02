import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const childProcess = require("node:child_process");
const modulePath = require.resolve("../../cli/hooks/sqliteRuntime.js");

// Issue #2493: a better-sqlite3 binary built for a different Node ABI has a
// perfectly valid ELF, Mach-O or PE header, so the magic-byte check passed it
// and the adapter chain then took SIGSEGV on dlopen — which no try/catch can
// catch. Issue #1605: the runtime packages were installed with --no-save, so
// they were extraneous and the next npm install in that directory pruned them.

let dataDir;
let previousDataDir;

function load() {
  delete require.cache[modulePath];
  return require(modulePath);
}

function nodeModules() {
  return path.join(dataDir, "runtime", "node_modules");
}

function seedSqlJs() {
  const wasm = path.join(nodeModules(), "sql.js", "dist", "sql-wasm.wasm");
  fs.mkdirSync(path.dirname(wasm), { recursive: true });
  fs.writeFileSync(wasm, "wasm");
}

// A file whose first bytes are a valid native-module header for this platform,
// which is all the pre-existing check ever looked at.
function seedBetterSqlite(abi) {
  const dir = path.join(nodeModules(), "better-sqlite3", "build", "Release");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(nodeModules(), "better-sqlite3", "package.json"), "{}");
  const magic = process.platform === "linux" ? [0x7f, 0x45, 0x4c, 0x46]
    : process.platform === "darwin" ? [0xcf, 0xfa, 0xed, 0xfe]
      : [0x4d, 0x5a, 0x00, 0x00];
  fs.writeFileSync(path.join(dir, "better_sqlite3.node"), Buffer.from(magic));
  if (abi !== undefined) {
    fs.writeFileSync(
      path.join(nodeModules(), ".tokenproxy-better-sqlite3-abi.json"),
      JSON.stringify({ modules: abi, version: "12.10.1" }),
    );
  }
}

beforeEach(() => {
  previousDataDir = process.env.DATA_DIR;
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenproxy-sqlite-abi-"));
  process.env.DATA_DIR = dataDir;
  seedSqlJs();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete require.cache[modulePath];
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("better-sqlite3 ABI stamp (#2493)", () => {
  it("rejects a binary stamped with a different Node ABI", () => {
    seedBetterSqlite("999");
    const spawn = vi.spyOn(childProcess, "spawnSync").mockReturnValue({ status: 1, stderr: "", stdout: "" });

    const result = load().ensureSqliteRuntime({ silent: true });

    expect(result.betterSqlite).toBe(false);
    spawn.mockRestore();
  });

  it("accepts a binary stamped with this Node ABI", () => {
    seedBetterSqlite(process.versions.modules);
    expect(load().ensureSqliteRuntime({ silent: true }).betterSqlite).toBe(true);
  });

  it("accepts an unstamped binary, so an existing install is never invalidated", () => {
    seedBetterSqlite(undefined);
    expect(load().ensureSqliteRuntime({ silent: true }).betterSqlite).toBe(true);
  });
});

describe("runtime installs are saved, not extraneous (#1605)", () => {
  it("never passes --no-save, which would let the next install prune the engine", () => {
    const calls = [];
    const spawn = vi.spyOn(childProcess, "spawnSync").mockImplementation((cmd, args) => {
      calls.push(args || []);
      return { status: 1, stderr: "", stdout: "" };
    });

    load().ensureSqliteRuntime({ silent: true, installBetterSqlite: true });

    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) expect(args).not.toContain("--no-save");
    spawn.mockRestore();
  });
});

describe("the native install is skipped on an unsupported Node (#1657)", () => {
  it("does not attempt an install that the pin cannot satisfy", () => {
    const orig = Object.getOwnPropertyDescriptor(process.versions, "node");
    const calls = [];
    const spawn = vi.spyOn(childProcess, "spawnSync").mockImplementation((cmd, args) => {
      calls.push(args || []);
      return { status: 1, stderr: "", stdout: "" };
    });
    try {
      // Node 18 is advertised by cli/package.json but is absent from the pinned
      // better-sqlite3's own engines field, so the build cannot succeed and the
      // install would just burn its timeout.
      Object.defineProperty(process.versions, "node", { value: "18.20.4", configurable: true });
      const result = load().ensureSqliteRuntime({ silent: true, installBetterSqlite: true });

      expect(result.betterSqlite).toBe(false);
      expect(calls.some((a) => a.some((x) => String(x).startsWith("better-sqlite3@")))).toBe(false);
    } finally {
      if (orig) Object.defineProperty(process.versions, "node", orig);
      spawn.mockRestore();
    }
  });

  it("still attempts the install on a supported Node major", () => {
    const orig = Object.getOwnPropertyDescriptor(process.versions, "node");
    const calls = [];
    const spawn = vi.spyOn(childProcess, "spawnSync").mockImplementation((cmd, args) => {
      calls.push(args || []);
      return { status: 1, stderr: "", stdout: "" };
    });
    try {
      Object.defineProperty(process.versions, "node", { value: "22.14.0", configurable: true });
      load().ensureSqliteRuntime({ silent: true, installBetterSqlite: true });

      expect(calls.some((a) => a.some((x) => String(x).startsWith("better-sqlite3@")))).toBe(true);
    } finally {
      if (orig) Object.defineProperty(process.versions, "node", orig);
      spawn.mockRestore();
    }
  });
});
