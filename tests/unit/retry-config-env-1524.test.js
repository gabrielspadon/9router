// Issue #1524 — retry attempts/delays were the one hardcoded knob left in
// runtimeConfig.js (backoff levels, connect timeouts, per-provider strategies
// and the concurrency cap all take an override). RETRY_ATTEMPTS_<status> and
// RETRY_DELAY_MS_<status> now override DEFAULT_RETRY_CONFIG, and a malformed or
// out-of-range value falls back to the compiled default rather than silently
// becoming zero retries or an unbounded loop.
import { afterEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [429, 502, 503, 504].flatMap((s) => [`RETRY_ATTEMPTS_${s}`, `RETRY_DELAY_MS_${s}`]);
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

async function loadWith(env = {}) {
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  vi.resetModules();
  return import("../../open-sse/config/runtimeConfig.js");
}

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.resetModules();
});

describe("DEFAULT_RETRY_CONFIG env overrides (#1524)", () => {
  it("keeps the shipped defaults when nothing is set", async () => {
    const { DEFAULT_RETRY_CONFIG } = await loadWith();
    expect(DEFAULT_RETRY_CONFIG).toEqual({
      429: { attempts: 0, delayMs: 0 },
      502: { attempts: 3, delayMs: 3000 },
      503: { attempts: 3, delayMs: 2000 },
      504: { attempts: 2, delayMs: 3000 },
    });
  });

  it("overrides attempts and delay per status code, leaving the others alone", async () => {
    const { DEFAULT_RETRY_CONFIG } = await loadWith({
      RETRY_ATTEMPTS_502: "5",
      RETRY_DELAY_MS_503: "500",
    });
    expect(DEFAULT_RETRY_CONFIG[502]).toEqual({ attempts: 5, delayMs: 3000 });
    expect(DEFAULT_RETRY_CONFIG[503]).toEqual({ attempts: 3, delayMs: 500 });
    expect(DEFAULT_RETRY_CONFIG[504]).toEqual({ attempts: 2, delayMs: 3000 });
  });

  it("lets an operator switch 429 retries on, which ship off by default", async () => {
    const { DEFAULT_RETRY_CONFIG, resolveRetryEntry } = await loadWith({
      RETRY_ATTEMPTS_429: "2",
      RETRY_DELAY_MS_429: "1500",
    });
    // executors/base.js reads it through resolveRetryEntry, so assert that view.
    expect(resolveRetryEntry(DEFAULT_RETRY_CONFIG[429])).toEqual({ attempts: 2, delayMs: 1500 });
  });

  it("accepts an explicit 0 as 'stop retrying this status'", async () => {
    const { DEFAULT_RETRY_CONFIG } = await loadWith({ RETRY_ATTEMPTS_502: "0" });
    expect(DEFAULT_RETRY_CONFIG[502].attempts).toBe(0);
  });

  it.each([
    ["not-a-number", "abc"],
    ["empty", ""],
    ["whitespace", "   "],
    ["negative", "-1"],
    ["fractional", "2.5"],
    ["above the ceiling", "10000"],
    ["Infinity", "Infinity"],
    ["NaN", "NaN"],
  ])("falls back to the default attempts on a %s value", async (_label, raw) => {
    const { DEFAULT_RETRY_CONFIG } = await loadWith({ RETRY_ATTEMPTS_502: raw });
    expect(DEFAULT_RETRY_CONFIG[502].attempts).toBe(3);
  });

  it.each(["abc", "-100", "600001", "1e999"])("falls back to the default delay on %s", async (raw) => {
    const { DEFAULT_RETRY_CONFIG } = await loadWith({ RETRY_DELAY_MS_502: raw });
    expect(DEFAULT_RETRY_CONFIG[502].delayMs).toBe(3000);
  });

  it("stays the config the retry loop actually reads", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../open-sse/executors/base.js", import.meta.url), "utf8"));
    expect(src).toContain("{ ...DEFAULT_RETRY_CONFIG, ...this.config.retry }");
  });
});
