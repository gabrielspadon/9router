import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

const chat = readFileSync(new URL("../../src/sse/handlers/chat.js", import.meta.url), "utf8");

// markAccountUnavailable computes how long an account is out for and the caller
// discarded it, so an account locked for two minutes was still retried three
// times before the loop moved on — two pointless upstream calls and the latency
// of both, every time.
describe("the same-account retry respects the cooldown it computed (#1641)", () => {
  it("reads the cooldown instead of dropping it", () => {
    expect(chat).toContain("const { shouldFallback, cooldownMs } = await markAccountUnavailable");
  });

  it("gates the retry on it", () => {
    expect(chat).toContain("fails < ACCOUNT_RETRY_LIMIT && cooldownMs <= SAME_ACCOUNT_RETRY_MAX_COOLDOWN_MS");
  });

  it("moves to the next account when the lock is long", () => {
    const branch = chat.slice(chat.indexOf("if (cooldownMs > SAME_ACCOUNT_RETRY_MAX_COOLDOWN_MS)"));
    const body = branch.slice(0, branch.indexOf("continue;"));
    expect(body).toContain("excludeConnectionIds.add(credentials.connectionId)");
  });

  it("sits between the short and long cooldowns, so a backed-off transient still retries", () => {
    const line = chat.split("\n").find((l) => l.includes("SAME_ACCOUNT_RETRY_MAX_COOLDOWN_MS ="));
    const ms = Number(eval(line.split("=")[1].replace(";", "")));
    // COOLDOWN.short is 5s, COOLDOWN.long is 2 minutes.
    expect(ms).toBeGreaterThan(5 * 1000);
    expect(ms).toBeLessThan(2 * 60 * 1000);
  });

  it("a rate limit still retries the same account, a bad key does not", () => {
    // The two ends of the scale, taken from the real classifier rather than
    // assumed: an early backoff is short, an auth failure is long.
    const rate = checkFallbackError(429, "rate limit exceeded", 0);
    const auth = checkFallbackError(401, "invalid api key", 0);
    expect(rate.cooldownMs).toBeLessThanOrEqual(30 * 1000);
    expect(auth.cooldownMs).toBeGreaterThan(30 * 1000);
  });
});
