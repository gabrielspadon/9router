import { describe, it, expect } from "vitest";
import {
  formatMeasure,
  freshnessTone,
  describeWindow,
} from "@/app/(dashboard)/dashboard/home/formatMeasure.js";
import { NOT_COMPUTABLE, NOT_RECORDED } from "@/shared/utils/measure";

// The whole point of the system-state contract is that three things stay
// distinguishable: a measurement (including a real zero), a value that could not
// be computed, and a value that was never recorded. A dash for all three is a
// different lie, not honesty. These tests hold that line.

const win = { kind: "rolling", seconds: 3600 };
const m = (over) => ({
  value: null,
  unit: "count",
  window: win,
  sampleCount: null,
  source: null,
  index: null,
  unavailable: null,
  ...over,
});

describe("formatMeasure", () => {
  it("renders a measured zero as a number, not as an absence", () => {
    const out = formatMeasure(m({ value: 0, unit: "ratio", sampleCount: 3 }));
    expect(out.available).toBe(true);
    expect(out.value).toBe("0.00");
    expect(out.unit).toBe("%");
  });

  it("calls a measure with no source never recorded, and carries its reason", () => {
    const out = formatMeasure(
      m({ unavailable: "no failover events are persisted", source: null }),
    );
    expect(out.available).toBe(false);
    expect(out.value).toBe(NOT_RECORDED);
    expect(out.reason).toBe("no failover events are persisted");
  });

  it("calls a measure that has a source but nothing to compute not computable", () => {
    const out = formatMeasure(
      m({ unavailable: "0 requests in the window", source: "requestStats", sampleCount: 0 }),
    );
    expect(out.available).toBe(false);
    expect(out.value).toBe(NOT_COMPUTABLE);
  });

  it("uses the same vocabulary as the rest of the product, not its own", () => {
    expect(NOT_RECORDED).toBe("not recorded");
    expect(NOT_COMPUTABLE).toBe("n/a");
  });

  it("never renders the reason as the only carrier of the state", () => {
    const out = formatMeasure(m({ unavailable: "no rows" }));
    expect(out.value).not.toBe("");
    expect(out.value).not.toBe("-");
    expect([NOT_RECORDED, NOT_COMPUTABLE]).toContain(out.value);
  });

  it("scales a sub-1 rate rather than rounding it to zero", () => {
    const out = formatMeasure(
      m({ value: 0.0008333, unit: "requests_per_second", sampleCount: 3 }),
    );
    expect(out.value).not.toBe("0.00");
    expect(out.unit).toBe("req/min");
    expect(out.value).toBe("0.05");
  });

  it("renders milliseconds under a second as milliseconds", () => {
    const out = formatMeasure(m({ value: 21, unit: "milliseconds", sampleCount: 3 }));
    expect(out.value).toBe("21");
    expect(out.unit).toBe("ms");
  });

  it("promotes milliseconds to seconds once a second is exceeded", () => {
    const out = formatMeasure(m({ value: 1840, unit: "milliseconds", sampleCount: 9 }));
    expect(out.value).toBe("1.84");
    expect(out.unit).toBe("s");
  });

  it("renders a ratio as a percentage with two decimals", () => {
    const out = formatMeasure(m({ value: 0.041, unit: "ratio", sampleCount: 100 }));
    expect(out.value).toBe("4.10");
    expect(out.unit).toBe("%");
  });

  it("carries the sample count so an average states its denominator", () => {
    const out = formatMeasure(m({ value: 21, unit: "milliseconds", sampleCount: 3 }));
    expect(out.sampleCount).toBe(3);
  });

  it("treats a missing measure as never recorded rather than throwing", () => {
    const out = formatMeasure(undefined);
    expect(out.available).toBe(false);
    expect(out.value).toBe(NOT_RECORDED);
  });
});

describe("freshnessTone", () => {
  it("is ok while live", () => {
    expect(freshnessTone({ state: "live", ageSeconds: 4 }).tone).toBe("ok");
  });
  it("is degraded when stale, and says how old", () => {
    const f = freshnessTone({ state: "stale", ageSeconds: 3287 });
    expect(f.tone).toBe("degraded");
    expect(f.label).toMatch(/54m|55m/);
  });
  it("is idle when nothing has ever been recorded", () => {
    expect(freshnessTone({ state: "empty", lastEventAt: null }).tone).toBe("idle");
  });
  it("states measured age when traffic is idle", () => {
    const f = freshnessTone({ state: "idle", ageSeconds: 7205 });
    expect(f.tone).toBe("idle");
    expect(f.label).toBe("idle, 2h");
  });
  it("never reports a state it was not given", () => {
    expect(freshnessTone(undefined).tone).toBe("idle");
    expect(freshnessTone(undefined).label).toBe("no data");
  });
});

describe("describeWindow", () => {
  it("states the window in words an operator reads once", () => {
    expect(describeWindow(win)).toBe("last 60 min");
  });
  it("handles an instant window", () => {
    expect(describeWindow({ kind: "instant" })).toBe("now");
  });
  it("does not invent a window it was not given", () => {
    expect(describeWindow(undefined)).toBe("");
  });
});

describe("shortReason", () => {
  it("keeps the operator clause and drops the maintainer's module path", () => {
    const out = formatMeasure(
      m({
        source: null,
        unavailable:
          "no failover events are persisted: open-sse/services/accountFallback.js keeps fallback state in memory",
      }),
    );
    expect(out.shortReason).toBe("no failover events are persisted");
    expect(out.reason).toContain("accountFallback.js");
  });

  it("leaves a reason with no colon alone", () => {
    const out = formatMeasure(m({ source: null, unavailable: "no rows in the window" }));
    expect(out.shortReason).toBe("no rows in the window");
  });

  it("has no short reason when there is nothing to shorten", () => {
    expect(formatMeasure(m({ value: 3, unit: "count" })).shortReason).toBeUndefined();
  });
});

describe("shortReason keeps a readout cell one line tall", () => {
  it("cuts at a parenthetical as well as at a colon", () => {
    const out = formatMeasure(
      m({
        source: "requestStats",
        unavailable:
          "no request in this window carries a measured latency (requestStats.latencyTotal is 0 for unmeasured and backfilled rows)",
      }),
    );
    expect(out.shortReason).toBe("no request in this window carries a measured latency");
  });

  it("caps a long clause that has neither, and marks the cut", () => {
    const long = "a".repeat(120);
    const out = formatMeasure(m({ source: "x", unavailable: long }));
    expect(out.shortReason.length).toBeLessThanOrEqual(72);
    expect(out.shortReason.endsWith("…")).toBe(true);
  });

  it("keeps the full reason available on the measure", () => {
    const full = "short clause: the long maintainer half with a module path in it";
    const out = formatMeasure(m({ source: "x", unavailable: full }));
    expect(out.shortReason).toBe("short clause");
    expect(out.reason).toBe(full);
  });
});

describe("denominators", () => {
  it("carries a denominator for a measure computed over a window of requests", () => {
    const out = formatMeasure(m({ value: 21, unit: "milliseconds", sampleCount: 4, window: win }));
    expect(out.sampleCount).toBe(4);
  });

  it("drops the denominator for an instant count, which is not over requests", () => {
    const out = formatMeasure(
      m({ value: 6, unit: "count", sampleCount: 6, window: { kind: "instant" } }),
    );
    expect(out.value).toBe("6");
    expect(out.sampleCount).toBe(null);
  });
});
