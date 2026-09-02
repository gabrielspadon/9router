import { describe, expect, it } from "vitest";
import {
  formatZedPlanLabel,
  getZedUsage,
  parseZedUsageLimit,
  parseZedUserUsage,
} from "../../open-sse/services/usage/zed.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { deriveQuotaSnapshot } from "../../src/shared/utils/quotaPause.js";

// Shapes below follow Zed's own public client types, not a captured account:
//   PlanInfo            — crates/cloud_api_types/src/plan.rs
//   CurrentUsage/UsageData/UsageLimit — crates/cloud_llm_client
// UsageLimit is an externally-tagged serde enum: {"limited": N} | "unlimited".
function userResponse(plan) {
  return {
    user: { id_v2: "u1", github_login: "octocat" },
    feature_flags: [],
    plan,
  };
}

describe("parseZedUsageLimit", () => {
  it("reads both serde forms of UsageLimit", () => {
    expect(parseZedUsageLimit({ limited: 2000 })).toEqual({ unlimited: false, total: 2000 });
    expect(parseZedUsageLimit("unlimited")).toEqual({ unlimited: true, total: 0 });
  });

  it("tolerates the bare-number and missing forms", () => {
    expect(parseZedUsageLimit(50)).toEqual({ unlimited: false, total: 50 });
    expect(parseZedUsageLimit("50")).toEqual({ unlimited: false, total: 50 });
    expect(parseZedUsageLimit(undefined)).toEqual({ unlimited: false, total: 0 });
  });
});

describe("formatZedPlanLabel", () => {
  it("labels every known plan_v3 id", () => {
    expect(formatZedPlanLabel("zed_free")).toBe("Zed Free");
    expect(formatZedPlanLabel("zed_pro")).toBe("Zed Pro");
    expect(formatZedPlanLabel("zed_student")).toBe("Zed Student");
  });

  it("still renders an unknown id, since plan_v3 is KnownOrUnknown", () => {
    expect(formatZedPlanLabel("zed_enterprise_2027")).toBe("Zed Enterprise 2027");
    expect(formatZedPlanLabel(null)).toBe("Zed");
  });
});

describe("parseZedUserUsage", () => {
  it("maps a limited edit-prediction bucket to a quota row with the billing-cycle reset", () => {
    const usage = parseZedUserUsage(
      userResponse({
        plan_v3: "zed_free",
        subscription_period: { started_at: "2026-08-01T00:00:00.000Z", ended_at: "2026-09-01T00:00:00.000Z" },
        usage: { edit_predictions: { used: 500, limit: { limited: 2000 } } },
        trial_started_at: null,
        is_account_too_young: false,
        has_overdue_invoices: false,
      }),
    );

    expect(usage.plan).toBe("Zed Free");
    expect(usage.message).toBeUndefined();
    expect(usage.quotas["Edit Predictions"]).toEqual({
      used: 500,
      total: 2000,
      remainingPercentage: 75,
      resetAt: "2026-09-01T00:00:00.000Z",
      unlimited: false,
    });
  });

  it("marks an unlimited bucket as unlimited instead of a zero cap", () => {
    const usage = parseZedUserUsage(
      userResponse({
        plan_v3: "zed_pro",
        subscription_period: { started_at: "2026-08-01T00:00:00.000Z", ended_at: "2026-09-01T00:00:00.000Z" },
        usage: { edit_predictions: { used: 1200, limit: "unlimited" } },
        has_overdue_invoices: false,
      }),
    );

    expect(usage.quotas["Edit Predictions"]).toMatchObject({
      used: 1200,
      total: 0,
      unlimited: true,
      remainingPercentage: 100,
    });
  });

  it("reads model_requests when an older deployment returns it", () => {
    const usage = parseZedUserUsage(
      userResponse({
        plan_v3: "zed_free",
        usage: {
          edit_predictions: { used: 10, limit: { limited: 100 } },
          model_requests: { used: 20, limit: { limited: 50 } },
        },
      }),
    );

    expect(Object.keys(usage.quotas)).toEqual(["Edit Predictions", "Hosted Model Requests"]);
    expect(usage.quotas["Hosted Model Requests"]).toMatchObject({ used: 20, total: 50, remainingPercentage: 60 });
  });

  it("drops a limited-0 bucket rather than rendering it as unlimited", () => {
    // QuotaTable prints `total > 0 ? total : "∞"`, so keeping a real zero cap
    // would advertise an unlimited quota that does not exist.
    const usage = parseZedUserUsage(
      userResponse({
        plan_v3: "zed_pro",
        usage: {
          edit_predictions: { used: 3, limit: { limited: 0 } },
          model_requests: { used: 9, limit: { limited: 0 } },
        },
      }),
    );

    expect(usage.quotas).toBeUndefined();
    expect(usage.message).toMatch(/no request quota/i);
  });

  it("keeps the quota rows when invoices are overdue, and says so on the plan label", () => {
    // A `message` REPLACES the quota table in the dashboard
    // (ProviderLimits/index.js:1404) and makes deriveQuotaSnapshot return null
    // (quotaPause.js:124), so billing state must not be reported that way while
    // real rows exist.
    const usage = parseZedUserUsage(
      userResponse({
        plan_v3: "zed_business",
        usage: { edit_predictions: { used: 5, limit: { limited: 10 } } },
        has_overdue_invoices: true,
      }),
    );

    expect(usage.message).toBeUndefined();
    expect(usage.quotas["Edit Predictions"]).toMatchObject({ used: 5, total: 10 });
    expect(usage.plan).toMatch(/overdue/i);
  });

  it("falls back to a message when a blocked account has no rows at all", () => {
    const usage = parseZedUserUsage(
      userResponse({ plan_v3: "zed_free", usage: {}, is_account_too_young: true }),
    );

    expect(usage.quotas).toBeUndefined();
    expect(usage.message).toMatch(/too new/i);
  });

  it("produces rows the routing quota-pause snapshot can consume", () => {
    const usage = parseZedUserUsage(
      userResponse({
        plan_v3: "zed_free",
        subscription_period: { started_at: "2026-08-01T00:00:00.000Z", ended_at: "2026-09-01T00:00:00.000Z" },
        usage: { edit_predictions: { used: 1900, limit: { limited: 2000 } } },
      }),
    );

    expect(deriveQuotaSnapshot("zed", usage)).toMatchObject({
      windows: [
        {
          key: "Edit Predictions",
          remainingPercentage: 5,
          resetAt: "2026-09-01T00:00:00.000Z",
          unlimited: false,
        },
      ],
    });
  });
});

describe("getZedUsage", () => {
  it("refuses without a token or a user id instead of calling out", async () => {
    await expect(getZedUsage(null, { userId: "u1" })).resolves.toMatchObject({
      message: expect.stringMatching(/access token not available/i),
    });
    await expect(getZedUsage("tok", {})).resolves.toMatchObject({
      message: expect.stringMatching(/missing its user id/i),
    });
  });

  it("is reachable through getUsageForProvider('zed')", async () => {
    const result = await getUsageForProvider({ provider: "zed", id: "c1", accessToken: null, providerSpecificData: {} });
    expect(result.message).not.toMatch(/not implemented/i);
    expect(result.message).toMatch(/Zed/);
  });
});
