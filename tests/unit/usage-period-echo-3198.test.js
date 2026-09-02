// #3198 — "Usage dashboard shows stale data from the initially-loaded period
// after switching period + sorting". Two server-side halves of that report:
//
//   1. A usage snapshot did not say which period it described, so a consumer
//      holding one had no way to tell it was answering the previous selection.
//   2. The SSE stream merged `getActiveRequests()` — a process-wide ring with no
//      period in it — over the period-scoped `recentRequests`, so the first
//      request to complete after a period switch put rows from outside the
//      selection back on screen, with no page refresh, beside totals that had
//      correctly excluded them.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { scopeRecentToPeriod, periodCutoffIso } from "@/lib/usagePeriod.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let adapter;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tokenproxy-period-echo-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  adapter = await (await import("@/lib/db/driver.js")).getAdapter();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

beforeEach(() => {
  adapter.run("DELETE FROM usageHistory");
  adapter.run("DELETE FROM usageDaily");
});

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const HOUR = 3600000;
const DAY = 86400000;

describe("a usage snapshot names the selection it answers (#3198)", () => {
  it("echoes the period it was asked for", async () => {
    for (const period of ["today", "24h", "7d", "30d", "60d", "all"]) {
      const stats = await db.getUsageStats(period);
      expect(stats.period).toBe(period);
      expect(stats.range).toBeNull();
    }
  });

  it("reports an explicit day range as a range, with its bounds", async () => {
    const stats = await db.getUsageStatsInRange("7d", {
      startDate: "2026-08-01",
      endDate: "2026-08-03",
    });
    expect(stats.period).toBe("range");
    expect(stats.range).toEqual({ startDate: "2026-08-01", endDate: "2026-08-03" });
  });

  it("keeps the echo consistent with the rows the snapshot counted", async () => {
    // One request today, one eight days back. "today" and "7d" must disagree on
    // the totals while each still labels itself correctly — that pairing is what
    // lets a client throw away the payload for a period it stopped showing.
    for (const at of [new Date().toISOString(), iso(8 * DAY)]) {
      adapter.run(
        `INSERT INTO usageHistory(timestamp, provider, model, endpoint, promptTokens, completionTokens, cost, status, tokens)
         VALUES(?, 'openai', 'gpt', '/v1/chat/completions', 10, 5, 0.01, 'ok', ?)`,
        [at, JSON.stringify({ prompt_tokens: 10, completion_tokens: 5 })],
      );
    }
    const today = await db.getUsageStats("today");
    expect(today.period).toBe("today");
    expect(today.recentRequests).toHaveLength(1);

    const all = await db.getUsageStats("all");
    expect(all.period).toBe("all");
    expect(all.recentRequests).toHaveLength(2);
  });
});

describe("recent rows are scoped to the period they are shown under (#3198)", () => {
  const rows = () => [
    { timestamp: iso(HOUR), model: "a" },
    { timestamp: iso(30 * HOUR), model: "b" },
    { timestamp: iso(10 * DAY), model: "c" },
    { timestamp: iso(90 * DAY), model: "d" },
  ];

  it("drops rows older than the selected window", () => {
    // One hour ago is not always in the current calendar day. Freeze time away
    // from midnight because the `today` contract intentionally starts at local
    // midnight while the other periods are rolling or day-based windows.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
    try {
      expect(scopeRecentToPeriod(rows(), "today").map((r) => r.model)).toEqual(["a"]);
      expect(scopeRecentToPeriod(rows(), "24h").map((r) => r.model)).toEqual(["a"]);
      expect(scopeRecentToPeriod(rows(), "7d").map((r) => r.model)).toEqual(["a", "b"]);
      expect(scopeRecentToPeriod(rows(), "30d").map((r) => r.model)).toEqual(["a", "b", "c"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("scopes nothing for 'all', which is the pre-existing behaviour", () => {
    expect(scopeRecentToPeriod(rows(), "all")).toHaveLength(4);
    expect(scopeRecentToPeriod(rows())).toHaveLength(4);
    expect(periodCutoffIso("all")).toBeNull();
  });

  it("survives an empty, absent or unusable ring", () => {
    expect(scopeRecentToPeriod([], "7d")).toEqual([]);
    expect(scopeRecentToPeriod(null, "7d")).toEqual([]);
    expect(scopeRecentToPeriod(undefined, "all")).toEqual([]);
    // A row that cannot be placed in time is not evidence that it belongs in the
    // window, and this panel sits under a period label.
    expect(scopeRecentToPeriod([{ model: "x" }, { timestamp: "nope" }], "7d")).toEqual([]);
  });
});
