import { afterAll, describe, expect, it } from "vitest";

// #3163 (chart side): the repo already emits a canonical `bucketStart` beside
// each hourly bucket, but the axis was bound to the pre-rendered `label`, which
// the SERVER formatted in its own zone. A viewer elsewhere therefore read hours
// that were not theirs. The tick is now derived from `bucketStart` in the
// viewer's local zone, with `label` as the fallback so day-period rows (which
// carry no `bucketStart`) still render exactly as before.
//
// Deliberately unchanged: the gateway-day boundary, DST policy, and every query.
const { formatBucketTick } = await import(
  "../../src/app/(dashboard)/dashboard/usage/components/UsageChart.js"
);

const ORIGINAL_TZ = process.env.TZ;
afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

const at = (tz, fn) => {
  process.env.TZ = tz;
  return fn();
};

// 2026-08-30T15:00:00Z — 15:00 in UTC, 00:00 the next day in Asia/Tokyo (+09).
const BUCKET_START = Date.UTC(2026, 7, 30, 15, 0, 0);

describe("UsageChart axis tick (#3163)", () => {
  it("renders the same bucketStart differently in each viewer's zone", () => {
    const utc = at("UTC", () => formatBucketTick({ bucketStart: BUCKET_START, label: "15:00" }));
    const tokyo = at("Asia/Tokyo", () => formatBucketTick({ bucketStart: BUCKET_START, label: "15:00" }));

    expect(utc).toBe("15:00");
    expect(tokyo).toBe("00:00");
    expect(tokyo).not.toBe(utc);
  });

  it("ignores the server-rendered label when bucketStart is present", () => {
    // The label carries the SERVER's zone; it must not win over the instant.
    const tick = at("Asia/Tokyo", () => formatBucketTick({ bucketStart: BUCKET_START, label: "15:00" }));
    expect(tick).toBe("00:00");
  });

  it("falls back to the label when bucketStart is absent (day periods, older rows)", () => {
    expect(at("Asia/Tokyo", () => formatBucketTick({ label: "Aug 30" }))).toBe("Aug 30");
    expect(at("UTC", () => formatBucketTick({ label: "Aug 30", bucketStart: null }))).toBe("Aug 30");
  });

  it("falls back to the label when bucketStart is not a usable instant", () => {
    // The `all` branch aliases a dateKey STRING as bucketStart in SQL; if that
    // ever reaches the client it must not be fed to `new Date`.
    expect(at("UTC", () => formatBucketTick({ label: "Aug 30, 2026", bucketStart: "2026-08-30" }))).toBe("Aug 30, 2026");
    expect(at("UTC", () => formatBucketTick({ label: "Aug 30", bucketStart: NaN }))).toBe("Aug 30");
  });

  it("returns an empty string rather than throwing on a missing row", () => {
    expect(at("UTC", () => formatBucketTick(undefined))).toBe("");
  });
});
