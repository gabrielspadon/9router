// #2126 — provider quota support tracker.
//
// The reporter's table lists OpenRouter-adjacent providers as unsupported, but
// most of that table is already served (ollama, opencode-go, claude, codex,
// antigravity all have parsers under open-sse/services/usage/). OpenRouter was
// the one genuine gap with a published, inference-key-authenticated quota API.
//
// NOT asserted here: that the dashboard LISTS openrouter. That needs
// `features: { usage: true, usageApikey: true }` on
// open-sse/providers/registry/openrouter.js, which is another lane's file.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const KEY_URL = "https://openrouter.ai/api/v1/key";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const CAPPED_KEY = {
  data: {
    label: "sk-or-v1-au7...890",
    is_free_tier: false,
    limit: 100,
    limit_remaining: 74.5,
    limit_reset: "monthly",
    usage: 25.5,
  },
};

describe("getUsageForProvider(openrouter)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GETs /api/v1/key with the connection's Bearer apiKey", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(CAPPED_KEY));

    const usage = await getUsageForProvider({ provider: "openrouter", apiKey: "sk-or-v1-test" });

    expect(usage.message).toBeUndefined();
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe(KEY_URL);
    expect(opts.method).toBe("GET");
    expect(opts.headers.Authorization).toBe("Bearer sk-or-v1-test");
  });

  it("maps limit/usage to one credit row, percentage only", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(CAPPED_KEY));

    const usage = await getUsageForProvider({ provider: "openrouter", apiKey: "k" });

    expect(usage.plan).toBe("OpenRouter");
    const row = usage.quotas["Credits (USD, monthly)"];
    expect(row).toMatchObject({ used: 25.5, total: 100, remainingPercentage: 74.5, unlimited: false });
    // UI reads `remaining` as a 0-100 percentage, so an absolute must not be set.
    expect(row.remaining).toBeUndefined();
    // limit_reset is a frequency word, never a timestamp.
    expect(row.resetAt).toBeNull();
  });

  it("reports an uncapped key as unlimited spend, not 0% remaining", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({ data: { is_free_tier: true, limit: null, limit_remaining: null, usage: 3.25 } }),
    );

    const usage = await getUsageForProvider({ provider: "openrouter", apiKey: "k" });

    expect(usage.plan).toBe("OpenRouter (Free Tier)");
    expect(usage.quotas["Spend (USD)"]).toMatchObject({
      used: 3.25,
      unlimited: true,
      remainingPercentage: 100,
    });
  });

  it("treats a zero cap as exhausted rather than uncapped", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({ data: { limit: 0, limit_remaining: 0, usage: 0 } }),
    );

    const usage = await getUsageForProvider({ provider: "openrouter", apiKey: "k" });

    expect(usage.quotas["Credits (USD)"]).toMatchObject({
      total: 0,
      remainingPercentage: 0,
      unlimited: false,
    });
  });

  it("derives remaining when the upstream omits limit_remaining", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({ data: { limit: 10, usage: 2.5 } }),
    );

    const usage = await getUsageForProvider({ provider: "openrouter", apiKey: "k" });

    expect(usage.quotas["Credits (USD)"].remainingPercentage).toBe(75);
  });

  it("returns a message, never a throw, on missing key / 401 / non-JSON", async () => {
    const missing = await getUsageForProvider({ provider: "openrouter" });
    expect(missing.message).toMatch(/api key/i);
    expect(proxyAwareFetch).not.toHaveBeenCalled();

    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ error: { code: 401 } }, 401));
    expect((await getUsageForProvider({ provider: "openrouter", apiKey: "bad" })).message)
      .toMatch(/auth|key/i);

    proxyAwareFetch.mockResolvedValueOnce(
      new Response("<html>", { status: 200, headers: { "Content-Type": "text/html" } }),
    );
    expect((await getUsageForProvider({ provider: "openrouter", apiKey: "k" })).message)
      .toMatch(/not JSON/i);

    proxyAwareFetch.mockRejectedValueOnce(new Error("boom"));
    expect((await getUsageForProvider({ provider: "openrouter", apiKey: "k" })).message)
      .toMatch(/boom/);
  });
});

describe("parseQuotaData(openrouter)", () => {
  it("renders through the generic default case with used/total", () => {
    const rows = parseQuotaData("openrouter", {
      plan: "OpenRouter",
      quotas: {
        "Credits (USD, monthly)": { used: 25.5, total: 100, remainingPercentage: 74.5, resetAt: null },
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Credits (USD, monthly)", used: 25.5, total: 100 });
  });
});
