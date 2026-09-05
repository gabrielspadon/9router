import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  writeContextStatus,
  readContextStatus,
  readAllContextStatuses,
  __setContextStatusDirForTest,
} from "../../open-sse/handlers/chatCore/contextStatusStore.js";

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ctx-status-test-"));
  __setContextStatusDirForTest(dir);
});

afterEach(() => {
  __setContextStatusDirForTest(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("contextStatusStore", () => {
  it("write/read roundtrip preserves allowlisted fields", () => {
    writeContextStatus("abcd1234", {
      rid: "0bad000a",
      ctxTokens: 12345,
      saveBytes: -800,
      ceBytes: 4096,
      compactHint: true,
      bogus: "dropped",
      saveBytesNegativeCheck: -5,
    });
    const entry = readContextStatus("abcd1234");
    expect(entry).toEqual({
      sid: "abcd1234",
      rid: "0bad000a",
      ctxTokens: 12345,
      saveBytes: -800, // signed delta preserved
      ceBytes: 4096,
      compactHint: true,
      updatedAt: entry.updatedAt,
    });
    expect(Number.isNaN(Date.parse(entry.updatedAt))).toBe(false);
  });

  it("omitted fields stay absent; saveBytes of exactly 0 is kept", () => {
    writeContextStatus("abcd1234", { rid: "0bad000b", ctxTokens: 100 });
    const entry = readContextStatus("abcd1234");
    expect(entry.saveBytes).toBeUndefined();
    expect(entry.ceBytes).toBeUndefined();
    expect(entry.compactHint).toBeUndefined();
  });

  it("rejects malformed sids and never touches disk", () => {
    writeContextStatus("not-hex!", { ctxTokens: 1 });
    writeContextStatus("abcd12345", { ctxTokens: 1 });
    writeContextStatus("", { ctxTokens: 1 });
    expect(fs.existsSync(path.join(dir, "context-status.json"))).toBe(false);
    expect(readContextStatus("not-hex!")).toBeNull();
  });

  it("LRU eviction drops the oldest entry at the 512 cap", () => {
    for (let i = 0; i < 512; i++) {
      writeContextStatus(i.toString(16).padStart(8, "0"), { ctxTokens: i });
    }
    expect(readAllContextStatuses()).toHaveLength(512);
    // touch the oldest so it becomes newest, then overflow by one
    writeContextStatus("00000000", { ctxTokens: 999 });
    writeContextStatus("00000200", { ctxTokens: 998 });
    const all = readAllContextStatuses();
    expect(all).toHaveLength(512);
    expect(all.at(-1).sid).toBe("00000200");
    expect(all.at(-2).sid).toBe("00000000");
    // order after the touches is [02..1ff,00]; adding 200 evicted the 01 head
    expect(all[0].sid).toBe("00000002");
    expect(readContextStatus("00000001")).toBeNull();
    expect(readContextStatus("00000002")).not.toBeNull();
    expect(readContextStatus("00000000").ctxTokens).toBe(999);
  });

  it("writes atomically with mode 0600 and no leftover tmp file", () => {
    writeContextStatus("abcd1234", { ctxTokens: 1 });
    const file = path.join(dir, "context-status.json");
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
    const mode = fs.statSync(file).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("corrupt file recovers to empty without throwing, then accepts writes", () => {
    fs.mkdirSync(path.join(dir, "token-saver"), { recursive: true });
    fs.writeFileSync(path.join(dir, "context-status.json"), "{not json");
    expect(readContextStatus("abcd1234")).toBeNull();
    expect(readAllContextStatuses()).toEqual([]);
    expect(() => writeContextStatus("abcd1234", { ctxTokens: 7 })).not.toThrow();
    expect(readContextStatus("abcd1234").ctxTokens).toBe(7);
  });

  it("truncated JSON mid-array also recovers empty", () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "context-status.json"),
      '{"v":1,"entries":[{"sid":"abcd1234","ctxTokens":5',
    );
    expect(readAllContextStatuses()).toEqual([]);
  });

  it("entries with wrong shape are dropped on read", () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "context-status.json"),
      JSON.stringify({
        v: 1,
        entries: [
          { sid: "abcd1234", ctxTokens: 5, updatedAt: "2026-09-04T00:00:00.000Z" },
          { sid: "ZZZ", ctxTokens: 6 },
          "garbage",
          { noSid: true },
        ],
      }),
    );
    const all = readAllContextStatuses();
    expect(all).toHaveLength(1);
    expect(all[0].sid).toBe("abcd1234");
  });
});
