/**
 * Google usage handlers (Gemini CLI + Antigravity)
 */

import { CLIENT_METADATA } from "../../config/appConstants.js";
import { ANTIGRAVITY_IDE_USER_AGENT, ANTIGRAVITY_IDE_VERSION, ANTIGRAVITY_OAUTH_CLIENT } from "../../providers/shared.js";
import { ANTIGRAVITY_SAFE_ERROR_MESSAGE, classifyAntigravityValidation } from "../antigravityValidation.js";
import { U, parseResetTime, normalizeCloudCodeProjectId, fetchWithTimeout } from "./shared.js";

// Antigravity API config (from Quotio) — urls from registry, oauth client + dynamic UA kept here
const ANTIGRAVITY_CONFIG = {
  ...U("antigravity"),
  ...ANTIGRAVITY_OAUTH_CLIENT,
  userAgent: ANTIGRAVITY_IDE_USER_AGENT,
};

const ANTIGRAVITY_PLAN_NAMES = new Set([
  "Free",
  "Pro",
  "Premium",
  "Google AI Pro",
  "Google AI Ultra",
]);

const ANTIGRAVITY_QUOTA_DISPLAY_NAMES = Object.freeze({
  "gemini-3.7-flash-high": ["Gemini 3.7 Flash (High)", "Gemini 3.7 Flash High"],
  "gemini-3.7-flash-medium": ["Gemini 3.7 Flash (Medium)", "Gemini 3.7 Flash Medium"],
  "gemini-3.7-flash-low": ["Gemini 3.7 Flash (Low)", "Gemini 3.7 Flash Low"],
  "gemini-3.6-flash-high": ["Gemini 3.6 Flash (High)", "Gemini 3.6 Flash High"],
  "gemini-3.6-flash-medium": ["Gemini 3.6 Flash (Medium)", "Gemini 3.6 Flash Medium"],
  "gemini-3.6-flash-low": ["Gemini 3.6 Flash (Low)", "Gemini 3.6 Flash Low"],
  "gemini-3.5-flash-low": ["Gemini 3.5 Flash (Medium)", "Gemini 3.5 Flash Medium"],
  "gemini-3.5-flash-extra-low": ["Gemini 3.5 Flash (Low)", "Gemini 3.5 Flash Low"],
  "gemini-pro-agent": ["Gemini 3.1 Pro (High)", "Gemini 3.1 Pro High"],
  "gemini-3.1-pro-low": ["Gemini 3.1 Pro (Low)", "Gemini 3.1 Pro Low"],
  "claude-sonnet-4-6": ["Claude Sonnet 4.6 (Thinking)", "Claude Sonnet 4.6 Thinking"],
  "claude-opus-4-6-thinking": ["Claude Opus 4.6 (Thinking)", "Claude Opus 4.6 Thinking"],
  "gpt-oss-120b-medium": ["GPT-OSS 120B (Medium)", "GPT-OSS 120B Medium"],
  "gemini-3.1-flash-image": ["Gemini 3.1 Flash Image"],
});

const usableAntigravityUsageResults = new WeakSet();

export function isUsableAntigravityUsageResult(result) {
  return !!result && typeof result === "object" && usableAntigravityUsageResults.has(result);
}

function safeAntigravityPlan(name) {
  return typeof name === "string" && ANTIGRAVITY_PLAN_NAMES.has(name) ? name : "Unknown";
}

function safeAntigravityQuotaDisplayName(modelKey, displayName) {
  const allowedDisplayNames = ANTIGRAVITY_QUOTA_DISPLAY_NAMES[modelKey];
  return allowedDisplayNames?.includes(displayName) ? displayName : modelKey;
}

async function readAntigravityJson(response) {
  const text = await response.text();
  try {
    return { text, data: text ? JSON.parse(text) : null };
  } catch {
    return { text, data: null };
  }
}

async function notifyAntigravityVerification(hooks, method, payload) {
  if (typeof hooks?.[method] !== "function") return;
  try {
    await hooks[method](payload);
  } catch {
    const connectionId = hooks?.verificationContext?.connectionId;
    console.error(
      `[Antigravity Usage] ${method} callback failed${connectionId ? ` for ${String(connectionId).slice(0, 12)}` : ""}`,
    );
  }
}

async function reportAntigravityValidation(validation, hooks) {
  if (!validation) return;
  await notifyAntigravityVerification(hooks, "onValidationRequired", {
    validation,
    observationId: hooks?.verificationContext?.observationId,
  });
}

/**
 * Gemini CLI Usage — fetch per-model quota via Cloud Code Assist API.
 * Uses retrieveUserQuota (same endpoint as `gemini /stats`) returning
 * per-model buckets with remainingFraction + resetTime.
 */
export async function getGeminiUsage(accessToken, providerSpecificData, proxyOptions = null) {
  if (!accessToken) {
    return { plan: "Free", message: "Gemini CLI access token not available." };
  }

  try {
    // Resolve project id: prefer connection-stored id, else loadCodeAssist lookup.
    // #1271: OAuth save stores projectId on the connection, not providerSpecificData.
    let projectId = normalizeCloudCodeProjectId(providerSpecificData?.projectId);
    let plan = "Free";

    if (!projectId) {
      const subInfo = await getGeminiSubscriptionInfo(accessToken, proxyOptions);
      projectId = normalizeCloudCodeProjectId(subInfo?.cloudaicompanionProject);
      plan = subInfo?.currentTier?.name || plan;
    }

    if (!projectId) {
      return {
        plan,
        message: "Gemini CLI project ID not available. Reconnect Gemini CLI, or configure a Google Cloud project with Gemini Code Assist access before checking quota.",
      };
    }

    const response = await fetchWithTimeout(
      U("gemini-cli").quotaUrl,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ project: projectId }),
      },
      10000,
      proxyOptions
    );

    if (!response.ok) {
      return { plan, message: `Gemini CLI quota error (${response.status}).` };
    }

    const data = await response.json();
    const quotas = {};

    if (Array.isArray(data.buckets)) {
      for (const bucket of data.buckets) {
        if (!bucket.modelId || bucket.remainingFraction == null) continue;

        const remainingFraction = Number(bucket.remainingFraction) || 0;
        const total = 1000; // Normalized base, matches antigravity convention
        const remaining = Math.round(total * remainingFraction);
        const used = Math.max(0, total - remaining);

        quotas[bucket.modelId] = {
          used,
          total,
          resetAt: parseResetTime(bucket.resetTime),
          remainingPercentage: remainingFraction * 100,
          unlimited: false,
        };
      }
    }

    return { plan, quotas };
  } catch {
    return { message: "Gemini CLI quota request failed." };
  }
}

/**
 * Get Gemini CLI subscription info via loadCodeAssist
 */
async function getGeminiSubscriptionInfo(accessToken, proxyOptions = null) {
  try {
    const response = await fetchWithTimeout(
      U("gemini-cli").loadCodeAssistUrl,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ metadata: CLIENT_METADATA }),
      },
      10000,
      proxyOptions
    );
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Antigravity Usage - Fetch quota from Google Cloud Code API
 */
export async function getAntigravityUsage(accessToken, providerSpecificData, proxyOptions = null, hooks = null) {
  try {
    // Fetch subscription info once — reuse for both projectId and plan
    const subscription = await getAntigravitySubscriptionInfo(accessToken, proxyOptions, hooks);
    if (subscription.validation) {
      return { message: "Antigravity account verification required.", quotas: {} };
    }
    const subscriptionInfo = subscription.data;
    const projectId = subscriptionInfo?.cloudaicompanionProject || null;

    const response = await fetchWithTimeout(ANTIGRAVITY_CONFIG.quotaApiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "User-Agent": ANTIGRAVITY_CONFIG.userAgent,
        "Content-Type": "application/json",
        "X-Client-Name": "antigravity",
        "X-Client-Version": ANTIGRAVITY_IDE_VERSION,
      },
      body: JSON.stringify({
        ...(projectId ? { project: projectId } : {})
      }),
    }, 10000, proxyOptions);

    const { data } = await readAntigravityJson(response);
    const validation = classifyAntigravityValidation({
      status: response.status,
      payload: data,
      source: "usage",
    });
    await reportAntigravityValidation(validation, hooks);

    if (response.status === 403) {
      return {
        message: "Antigravity quota API access forbidden. Chat may still work.",
        quotas: {}
      };
    }

    if (response.status === 401) {
      return {
        message: "Antigravity quota API authentication expired. Chat may still work.",
        quotas: {}
      };
    }

    if (!response.ok) {
      const safeStatus = Number.isInteger(response.status) && response.status >= 400 && response.status < 600
        ? response.status
        : 502;
      return {
        message: `Antigravity quota API request failed (${safeStatus}).`,
        quotas: {},
      };
    }

    if (
      !data
      || typeof data !== "object"
      || Array.isArray(data)
      || data.message
      || data.error
      || !Object.prototype.hasOwnProperty.call(data, "models")
      || !data.models
      || typeof data.models !== "object"
      || Array.isArray(data.models)
    ) {
      return { message: "Antigravity quota response was not usable.", quotas: {} };
    }
    const quotas = {};

    // Parse model quotas (inspired by vscode-antigravity-cockpit)
    if (data.models) {
      // Filter only recommended/important models (must match PROVIDER_MODELS ag ids)
      const importantModels = [
        'gemini-3.7-flash-high',
        'gemini-3.7-flash-medium',
        'gemini-3.7-flash-low',
        'gemini-3.6-flash-high',
        'gemini-3.6-flash-medium',
        'gemini-3.6-flash-low',
        'gemini-3.5-flash-low',
        'gemini-3.5-flash-extra-low',
        'gemini-pro-agent',
        'gemini-3.1-pro-low',
        'claude-sonnet-4-6',
        'claude-opus-4-6-thinking',
        'gpt-oss-120b-medium',
        // Image generation models
        'gemini-3.1-flash-image',
      ];

      for (const [modelKey, info] of Object.entries(data.models)) {
        // Skip models without quota info
        if (!info.quotaInfo) {
          continue;
        }

        // Skip internal models and non-important models
        if (info.isInternal || !importantModels.includes(modelKey)) {
          continue;
        }

        const remainingFraction = info.quotaInfo.remainingFraction || 0;
        const remainingPercentage = remainingFraction * 100;

        // Convert percentage to used/total for UI compatibility
        const total = 1000; // Normalized base
        const remaining = Math.round(total * remainingFraction);
        const used = total - remaining;

        // Use modelKey as key (matches PROVIDER_MODELS id)
        quotas[modelKey] = {
          used,
          total,
          resetAt: parseResetTime(info.quotaInfo.resetTime),
          remainingPercentage,
          unlimited: false,
          displayName: safeAntigravityQuotaDisplayName(modelKey, info.displayName),
        };
      }
    }

    const result = {
      plan: safeAntigravityPlan(subscriptionInfo?.currentTier?.name),
      quotas,
    };
    usableAntigravityUsageResults.add(result);
    await notifyAntigravityVerification(hooks, "onVerificationSuccess", {
      challengeId: hooks?.verificationContext?.challengeIdAtStart,
    });
    return result;
  } catch (error) {
    console.error("[Antigravity Usage] Error");
    return {
      message: "Antigravity usage is temporarily unavailable.",
      quotas: {},
    };
  }
}

/**
 * Get Antigravity subscription info
 */
async function getAntigravitySubscriptionInfo(accessToken, proxyOptions = null, hooks = null) {
  try {
    const response = await fetchWithTimeout(ANTIGRAVITY_CONFIG.loadProjectApiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "User-Agent": ANTIGRAVITY_CONFIG.userAgent,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ metadata: CLIENT_METADATA, mode: 1 }),
    }, 10000, proxyOptions);

    const { data } = await readAntigravityJson(response);
    const validation = classifyAntigravityValidation({
      status: response.status,
      payload: data,
      source: "loadCodeAssist",
    });
    await reportAntigravityValidation(validation, hooks);
    if (validation) return { data: null, validation };
    if (!response.ok) return { data: null, validation: null };
    return { data, validation: null };
  } catch {
    console.error("[Antigravity Subscription] Error:", ANTIGRAVITY_SAFE_ERROR_MESSAGE);
    return { data: null, validation: null };
  }
}
