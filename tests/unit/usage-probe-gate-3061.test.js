import { beforeEach, describe, expect, it } from "vitest";
import {
  runUsageProbe,
  __resetUsageProbeGate,
  MAX_CONCURRENT_PROBES,
} from "@/lib/usageProbeGate.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const settle = () => new Promise((r) => setImmediate(r));

beforeEach(() => __resetUsageProbeGate());

// The dashboard fetches every connection's quota at once, and each fetch is a
// live provider call preceded by a token refresh. With thirty accounts nothing
// bounded the fan-out (#3061).
describe("live quota probes run under a ceiling (#3061)", () => {
  it("never runs more than the limit at once, however many are asked for", async () => {
    let running = 0, peak = 0;
    const gates = [];
    const probes = Array.from({ length: 30 }, () => {
      const d = deferred();
      gates.push(d);
      return () => { running++; peak = Math.max(peak, running); return d.promise.finally(() => running--); };
    });

    const all = probes.map((p, i) => runUsageProbe(`conn-${i}|cached`, p));
    await settle();
    expect(peak).toBe(MAX_CONCURRENT_PROBES);

    gates.forEach((g) => g.resolve("ok"));
    await Promise.all(all);
    expect(peak).toBe(MAX_CONCURRENT_PROBES);
  });

  it("drains the queue, so a bounded ceiling is not a dropped request", async () => {
    const seen = [];
    const all = Array.from({ length: 12 }, (_, i) =>
      runUsageProbe(`conn-${i}|cached`, async () => { seen.push(i); return i; }));
    expect(await Promise.all(all)).toEqual([...Array(12).keys()]);
    expect(seen).toHaveLength(12);
  });

  it("collapses concurrent callers that want the same thing onto one call", async () => {
    let calls = 0;
    const d = deferred();
    const probe = () => { calls++; return d.promise; };
    const a = runUsageProbe("same|cached", probe);
    const b = runUsageProbe("same|cached", probe);
    expect(a).toBe(b);
    d.resolve("shared");
    expect(await a).toBe("shared");
    expect(await b).toBe("shared");
    expect(calls).toBe(1);
  });

  it("a forced refresh is not served by an unforced probe already in flight", async () => {
    let calls = 0;
    const probe = async () => { calls++; return calls; };
    await Promise.all([
      runUsageProbe("same|cached", probe),
      runUsageProbe("same|force", probe),
    ]);
    expect(calls).toBe(2);
  });

  it("a failed probe releases its slot instead of wedging the gate shut", async () => {
    const failing = Array.from({ length: MAX_CONCURRENT_PROBES }, (_, i) =>
      runUsageProbe(`bad-${i}|cached`, async () => { throw new Error("upstream down"); })
        .catch((e) => e.message));
    expect(await Promise.all(failing)).toEqual(Array(MAX_CONCURRENT_PROBES).fill("upstream down"));
    expect(await runUsageProbe("good|cached", async () => "alive")).toBe("alive");
  });

  it("a key is reusable once its probe has settled", async () => {
    let calls = 0;
    const probe = async () => ++calls;
    expect(await runUsageProbe("same|cached", probe)).toBe(1);
    expect(await runUsageProbe("same|cached", probe)).toBe(2);
  });
});
