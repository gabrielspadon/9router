/**
 * Zed usage — GET https://cloud.zed.dev/client/users/me
 * Auth: "Authorization: <user_id> <access_token>" (built by shared/zedAuth.js).
 *
 * The response shape is fixed by Zed's own public client types, not guessed:
 *   crates/cloud_api_types/src/plan.rs → PlanInfo { plan_v3, subscription_period,
 *       usage, trial_started_at, is_account_too_young, has_overdue_invoices }
 *   crates/cloud_llm_client/…          → CurrentUsage { edit_predictions: UsageData },
 *       UsageData { used: u32, limit: UsageLimit }
 * `UsageLimit` is an externally-tagged serde enum, so its JSON is `{"limited": N}`
 * or the string `"unlimited"`. `subscription_period.ended_at` is RFC 3339.
 * `model_requests` is absent from the current CurrentUsage but still returned by
 * older deployments, so it is read when present and ignored when not.
 */

import { ZED_CLOUD_BASE_URL, ZED_HEADERS, buildZedUserAuthHeader } from "../../shared/zedAuth.js";
import { fetchWithTimeout, parseResetTime, toFiniteNumber } from "./shared.js";

const USER_URL = `${ZED_CLOUD_BASE_URL}/client/users/me`;

const PLAN_LABELS = {
  zed_free: "Zed Free",
  zed_pro: "Zed Pro",
  zed_pro_trial: "Zed Pro Trial",
  zed_business: "Zed Business",
  zed_student: "Zed Student",
  zed_vip: "Zed VIP",
};

/** plan_v3 is KnownOrUnknown<Plan,String>, so an unrecognised id must still render. */
export function formatZedPlanLabel(rawPlan) {
  const raw = String(rawPlan || "").trim();
  if (!raw) return "Zed";
  const known = PLAN_LABELS[raw.toLowerCase()];
  if (known) return known;
  return raw
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * UsageLimit → { unlimited, total }. `{"limited": N}` and `"unlimited"` are the
 * serde forms; a bare number is accepted because Zed's FromStr path emits one.
 */
export function parseZedUsageLimit(limit) {
  if (limit === "unlimited") return { unlimited: true, total: 0 };
  if (typeof limit === "number" && Number.isFinite(limit)) {
    return { unlimited: false, total: Math.max(0, limit) };
  }
  if (typeof limit === "string") {
    const n = Number(limit.trim());
    if (Number.isFinite(n)) return { unlimited: false, total: Math.max(0, n) };
    return { unlimited: false, total: 0 };
  }
  if (limit && typeof limit === "object") {
    if (limit.unlimited === true || limit.Unlimited !== undefined) {
      return { unlimited: true, total: 0 };
    }
    const limited = limit.limited ?? limit.Limited;
    if (typeof limited === "number" && Number.isFinite(limited)) {
      return { unlimited: false, total: Math.max(0, limited) };
    }
  }
  return { unlimited: false, total: 0 };
}

/**
 * One quota row, or null when the bucket carries no renderable limit.
 * A `{"limited": 0}` bucket is dropped rather than rendered: QuotaTable prints
 * `total > 0 ? total : "∞"`, so a real zero cap would display as unlimited.
 */
function zedQuotaRow(bucket, resetAt) {
  if (!bucket || typeof bucket !== "object") return null;
  const used = Math.max(0, toFiniteNumber(bucket.used, 0));
  const { unlimited, total } = parseZedUsageLimit(bucket.limit);

  if (unlimited) {
    return { used, total: 0, remainingPercentage: 100, resetAt, unlimited: true };
  }
  if (total <= 0) return null;

  const clamped = Math.min(used, total);
  return {
    used: clamped,
    total,
    remainingPercentage: ((total - clamped) / total) * 100,
    resetAt,
    unlimited: false,
  };
}

/**
 * GetAuthenticatedUserResponse → { plan, quotas } | { plan, message }.
 *
 * `message` is set ONLY when there is no quota row, because the dashboard renders
 * the message INSTEAD of the quota table (ProviderLimits/index.js:1404) and
 * deriveQuotaSnapshot bails on any usage carrying one (quotaPause.js:124).
 * Billing state therefore rides on the plan label whenever rows exist, so nothing
 * is hidden in order to surface it.
 */
export function parseZedUserUsage(userInfo) {
  const plan = userInfo?.plan || {};
  const usage = plan.usage || {};
  const resetAt = parseResetTime(plan.subscription_period?.ended_at) || null;

  const quotas = {};
  const editPredictions = zedQuotaRow(usage.edit_predictions, resetAt);
  if (editPredictions) quotas["Edit Predictions"] = editPredictions;
  const modelRequests = zedQuotaRow(usage.model_requests, resetAt);
  if (modelRequests) quotas["Hosted Model Requests"] = modelRequests;

  const overdue = plan.has_overdue_invoices === true;
  const tooYoung = plan.is_account_too_young === true;
  let planLabel = formatZedPlanLabel(plan.plan_v3);
  if (plan.trial_started_at && !/trial/i.test(planLabel)) planLabel += " (Trial)";
  if (overdue) planLabel += " · billing overdue";

  if (Object.keys(quotas).length === 0) {
    if (overdue) {
      return {
        plan: planLabel,
        message: "Zed reports overdue invoices. Usage may be blocked until billing is resolved.",
      };
    }
    if (tooYoung) {
      return {
        plan: planLabel,
        message: "This Zed account is too new for the free plan's hosted models.",
      };
    }
    // Pro/Business bill hosted models per token rather than per request, so Zed
    // returns no request-count quota for them.
    return {
      plan: planLabel,
      message: "Zed connected. This plan reports no request quota; hosted model spend is on dashboard.zed.dev.",
    };
  }

  return { plan: planLabel, quotas };
}

/**
 * @param {string|null|undefined} accessToken
 * @param {object|null|undefined} providerSpecificData - carries userId/systemId
 * @param {object|null} proxyOptions
 */
export async function getZedUsage(accessToken = null, providerSpecificData = null, proxyOptions = null) {
  const psd = providerSpecificData || {};
  if (!accessToken || typeof accessToken !== "string" || !accessToken.trim()) {
    return { message: "Zed access token not available. Re-connect Zed to view quota." };
  }
  if (!psd.userId) {
    return { message: "Zed credential is missing its user id. Re-connect Zed to view quota." };
  }

  const headers = { Accept: "application/json" };
  try {
    headers.Authorization = buildZedUserAuthHeader({
      accessToken: accessToken.trim(),
      providerSpecificData: psd,
    });
  } catch (error) {
    return { message: `Zed credential incomplete: ${error.message}` };
  }
  if (psd.systemId) headers[ZED_HEADERS.systemId] = String(psd.systemId);

  try {
    const response = await fetchWithTimeout(USER_URL, { method: "GET", headers }, 10000, proxyOptions);

    if (response.status === 401 || response.status === 403) {
      return { message: "Zed authentication failed or expired. Re-connect Zed to view quota." };
    }
    if (!response.ok) {
      return { message: `Zed usage API error (${response.status}).` };
    }

    const data = await response.json().catch(() => null);
    if (!data || typeof data !== "object") {
      return { message: "Zed usage response was not JSON." };
    }
    return parseZedUserUsage(data);
  } catch (error) {
    return { message: `Zed error: ${error.message}` };
  }
}
