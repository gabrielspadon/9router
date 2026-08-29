import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import {
  USAGE_SUPPORTED_PROVIDERS,
  USAGE_APIKEY_PROVIDERS,
} from "../../src/shared/constants/providers.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("usage registry flags", () => {
  it("includes opencode-go and cloudflare-ai in usage-supported apikey providers", () => {
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("opencode-go");
    expect(USAGE_APIKEY_PROVIDERS).toContain("opencode-go");
    expect(USAGE_SUPPORTED_PROVIDERS).toContain("cloudflare-ai");
    expect(USAGE_APIKEY_PROVIDERS).toContain("cloudflare-ai");
  });
});

describe("OpenCode Go usage parsing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches and parses OpenCode Go rolling and monthly limits", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        usage: {
          rolling: {
            status: "ok",
            percent: 15,
            resetsAt: "2026-08-15T02:08:13.245Z",
          },
          weekly: {
            status: "ok",
            percent: 40,
            resetsAt: "2026-08-17T00:00:00.245Z",
          },
          monthly: {
            status: "rate-limited",
            percent: 100,
            resetsAt: "2026-08-26T09:20:20.245Z",
          },
        },
      }),
    );

    const usage = await getUsageForProvider({
      provider: "opencode-go",
      apiKey: "ocg-key",
    });

    expect(usage.plan).toBe("OpenCode Go");
    expect(usage.quotas["Rolling (5h)"].used).toBe(15);
    expect(usage.quotas["Weekly"].used).toBe(40);
    expect(usage.quotas["Monthly"].used).toBe(100);

    const parsed = parseQuotaData("opencode-go", usage);
    expect(parsed.length).toBe(3);
    expect(parsed.find((q) => q.name === "Monthly").used).toBe(100);
  });
});

describe("Cloudflare Workers AI usage parsing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sums neurons from GraphQL analytics groups", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({
        data: {
          viewer: {
            accounts: [
              {
                aiWorkersAiInvocationsAdaptiveGroups: [
                  { sum: { neurons: 4000, requests: 10 } },
                  { sum: { neurons: 2500.5, requests: 7 } },
                ],
              },
            ],
          },
        },
      }),
    );

    const usage = await getUsageForProvider({
      provider: "cloudflare-ai",
      apiKey: "cf-token",
      providerSpecificData: { accountId: "acct" },
    });

    expect(usage.quotas.neurons.used).toBeCloseTo(6500.5);
    expect(usage.quotas.neurons.total).toBe(10000);
    expect(usage.quotas.requests.used).toBe(17);
    expect(usage.quotas.requests.unlimited).toBe(true);
  });

  it("returns a message when the Account ID is missing", async () => {
    const usage = await getUsageForProvider({
      provider: "cloudflare-ai",
      apiKey: "cf-token",
    });
    expect(usage.message).toMatch(/Account ID/);
  });
});
