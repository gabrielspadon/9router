import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tokenproxy-usage-chart-tz-"));
process.env.DATA_DIR = TEMP_DATA_DIR;

const { getAdapter } = await import("../../src/lib/db/driver.js");
const { getChartData } = await import("../../src/lib/db/repos/usageRepo.js");
const { GET } = await import("../../src/app/api/usage/chart/route.js");

const HOUR_MS = 3600000;

let db;

beforeAll(async () => {
  db = await getAdapter();
});

beforeEach(() => {
  db.run("DELETE FROM usageHistory");
  db.run("DELETE FROM usageDaily");
});

// #3163: the hourly buckets only ever carried a label formatted with the SERVER
// process locale/zone, so a viewer in another zone read hours that were not
// theirs and had nothing to re-format from. The canonical bucket-start instant
// is what the browser needs; the gateway-day boundary and the existing
// (period, range) selection semantics deliberately do NOT move.
describe("hourly usage chart carries a canonical bucket start (#3163)", () => {
  it("stamps every today bucket with its own hour boundary", async () => {
    const buckets = await getChartData("today");

    expect(buckets).toHaveLength(24);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    expect(buckets[0].bucketStart).toBe(startOfDay.getTime());
    buckets.forEach((bucket, i) => {
      expect(bucket.bucketStart).toBe(startOfDay.getTime() + i * HOUR_MS);
    });
  });

  it("stamps every 24h bucket with its own hour boundary", async () => {
    const buckets = await getChartData("24h");

    expect(buckets).toHaveLength(24);
    for (const bucket of buckets) expect(Number.isFinite(bucket.bucketStart)).toBe(true);
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i].bucketStart - buckets[i - 1].bucketStart).toBe(HOUR_MS);
    }
  });

  it("keeps the label and totals alongside the instant, and serves both over the API", async () => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    db.run(
      "INSERT INTO usageHistory(timestamp, promptTokens, completionTokens, cost) VALUES(?, ?, ?, ?)",
      [new Date(startOfDay.getTime() + 90 * 60 * 1000).toISOString(), 7, 3, 0.5]
    );

    const response = await GET(new Request("http://localhost/api/usage/chart?period=today"));
    expect(response.status).toBe(200);
    const served = await response.json();

    expect(served[1]).toEqual(expect.objectContaining({
      bucketStart: startOfDay.getTime() + HOUR_MS,
      tokens: 10,
      cost: 0.5,
    }));
    expect(typeof served[1].label).toBe("string");
  });

  // The route must stay range-shaped: a timezone query parameter would make the
  // browser's day disagree with the persisted gateway day (#3163).
  it("ignores a client-supplied timezone parameter", async () => {
    const withTz = await GET(new Request("http://localhost/api/usage/chart?period=today&tz=Pacific/Kiritimati"));
    const plain = await GET(new Request("http://localhost/api/usage/chart?period=today"));

    expect(await withTz.json()).toEqual(await plain.json());
  });
});
