import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyAwareFetch = vi.fn();

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

describe("Codex usage windows", () => {
  beforeEach(() => vi.clearAllMocks());

  it("classifies a single seven-day primary window as weekly", async () => {
    proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        plan_type: "team",
        rate_limit: {
          primary_window: {
            used_percent: 19,
            limit_window_seconds: 604800,
            reset_at: 1785678428,
          },
        },
      }),
    });

    const { getCodexUsage } = await import("../../open-sse/services/usage/codex.js");
    const usage = await getCodexUsage("token");

    expect(Object.keys(usage.quotas)).toEqual(["weekly"]);
    expect(usage.quotas.weekly).toMatchObject({ used: 19, windowSeconds: 604800 });
  });

  it("displays 5h and Weekly labels while retaining raw quota identities", async () => {
    const { parseQuotaData } = await import(
      "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js"
    );

    const quotas = parseQuotaData("codex", {
      quotas: {
        session: { used: 7, total: 100 },
        weekly: { used: 19, total: 100 },
      },
    });

    expect(quotas.map(({ name, modelKey }) => ({ name, modelKey }))).toEqual([
      { name: "5h", modelKey: "session" },
      { name: "Weekly", modelKey: "weekly" },
    ]);
  });

  it.each(["limit_window_seconds", "window_seconds", "windowSeconds"])(
    "classifies %s duration independently of primary and secondary position",
    async (durationField) => {
      proxyAwareFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          rate_limit: {
            primary_window: { used_percent: 19, [durationField]: 604800 },
            secondary_window: { used_percent: 7, [durationField]: 18000 },
          },
        }),
      });

      const { getCodexUsage } = await import("../../open-sse/services/usage/codex.js");
      const usage = await getCodexUsage("token");

      expect(usage.quotas).toMatchObject({
        weekly: { used: 19, windowSeconds: 604800 },
        session: { used: 7, windowSeconds: 18000 },
      });
    },
  );

  it("uses positional session and weekly fallbacks when durations are absent", async () => {
    proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        rate_limit: {
          primary_window: { used_percent: 7 },
          secondary_window: { used_percent: 19 },
        },
      }),
    });

    const { getCodexUsage } = await import("../../open-sse/services/usage/codex.js");
    const usage = await getCodexUsage("token");

    expect(Object.keys(usage.quotas)).toEqual(["session", "weekly"]);
    expect(usage.quotas).toMatchObject({
      session: { used: 7, windowSeconds: null },
      weekly: { used: 19, windowSeconds: null },
    });
  });

  it("classifies and labels review-prefixed windows by duration", async () => {
    proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        code_review_rate_limit: {
          primary_window: { used_percent: 23, window_seconds: 604800 },
          secondary_window: { used_percent: 11, window_seconds: 18000 },
        },
      }),
    });

    const { getCodexUsage } = await import("../../open-sse/services/usage/codex.js");
    const { parseQuotaData } = await import(
      "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js"
    );
    const usage = await getCodexUsage("token");
    const quotas = parseQuotaData("codex", usage);

    expect(quotas.map(({ name, modelKey, used }) => ({ name, modelKey, used }))).toEqual([
      { name: "Review Weekly", modelKey: "review_weekly", used: 23 },
      { name: "Review 5h", modelKey: "review_session", used: 11 },
    ]);
  });

  it("keeps same-type primary and secondary windows separately observable", async () => {
    proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        rate_limit: {
          primary_window: { used_percent: 13, windowSeconds: 604800 },
          secondary_window: { used_percent: 29, windowSeconds: 604800 },
        },
        review_rate_limit: {
          primary_window: { used_percent: 7, windowSeconds: 18000 },
          secondary_window: { used_percent: 17, windowSeconds: 18000 },
        },
      }),
    });

    const { getCodexUsage } = await import("../../open-sse/services/usage/codex.js");
    const { parseQuotaData } = await import(
      "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js"
    );
    const usage = await getCodexUsage("token");
    const quotas = parseQuotaData("codex", usage);

    expect(quotas.map(({ name, modelKey, used }) => ({ name, modelKey, used }))).toEqual([
      { name: "Weekly", modelKey: "weekly", used: 13 },
      { name: "Weekly", modelKey: "weekly_secondary", used: 29 },
      { name: "Review 5h", modelKey: "review_session", used: 7 },
      { name: "Review 5h", modelKey: "review_session_secondary", used: 17 },
    ]);
  });

  it("preserves upstream window duration so consumers can label 5h and 7d correctly", async () => {
    proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        plan_type: "team",
        rate_limit: {
          primary_window: {
            used_percent: 7,
            limit_window_seconds: 18000,
            reset_at: 1785623016,
          },
          secondary_window: {
            used_percent: 19,
            limit_window_seconds: 604800,
            reset_at: 1785678428,
          },
        },
      }),
    });

    const { getCodexUsage } = await import("../../open-sse/services/usage/codex.js");

    await expect(getCodexUsage("token")).resolves.toMatchObject({
      quotas: {
        session: { used: 7, windowSeconds: 18000 },
        weekly: { used: 19, windowSeconds: 604800 },
      },
    });
  });
});
