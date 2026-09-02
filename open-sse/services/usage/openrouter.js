/**
 * OpenRouter usage — GET https://openrouter.ai/api/v1/key
 * Auth: Bearer <apiKey>
 *
 * The key endpoint is authenticated by the INFERENCE key the connection
 * already stores, and reports that key's own spend and cap. `/api/v1/credits`
 * reports the account pot instead, but it requires a MANAGEMENT key, which a
 * routing connection never holds — so it is not usable here (#2126).
 *
 * Docs: https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { toFiniteNumber } from "./shared.js";

const KEY_URL = "https://openrouter.ai/api/v1/key";

/**
 * @param {string|null|undefined} apiKey
 * @param {object|null} proxyOptions
 */
export async function getOpenRouterUsage(apiKey = null, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: "OpenRouter API key not available. Add a key to view usage." };
  }

  try {
    const response = await proxyAwareFetch(
      KEY_URL,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          Accept: "application/json",
        },
      },
      proxyOptions,
    );

    if (response.status === 401 || response.status === 403) {
      return { plan: "OpenRouter", message: "OpenRouter authentication failed. Check the API key." };
    }

    if (!response.ok) {
      return { plan: "OpenRouter", message: `OpenRouter key API error (${response.status}).` };
    }

    const json = await response.json().catch(() => null);
    const data = json?.data;
    if (!data || typeof data !== "object") {
      return { message: "OpenRouter key response was not JSON." };
    }

    const used = toFiniteNumber(data.usage, 0);
    // `limit` is null on an uncapped key, and null is not the same as 0: a 0 cap
    // is a frozen key and must still render as exhausted. Only a finite number
    // is a ceiling, so the null branch is taken on null/undefined alone.
    const limit = typeof data.limit === "number" && Number.isFinite(data.limit) ? data.limit : null;

    // limit_reset is a FREQUENCY word ("monthly"), never a timestamp — putting it
    // in resetAt would render as an Invalid Date, so it goes in the row label.
    const period = typeof data.limit_reset === "string" ? data.limit_reset.trim() : "";
    const plan = data.is_free_tier === true ? "OpenRouter (Free Tier)" : "OpenRouter";

    if (limit === null) {
      // No cap on this key. Report spend so the row is not empty, and mark it
      // unlimited so no bar claims a remaining fraction that does not exist.
      return {
        plan,
        quotas: {
          "Spend (USD)": {
            used,
            total: 0,
            remainingPercentage: 100,
            resetAt: null,
            unlimited: true,
          },
        },
      };
    }

    const remaining =
      typeof data.limit_remaining === "number" && Number.isFinite(data.limit_remaining)
        ? Math.max(0, data.limit_remaining)
        : Math.max(0, limit - used);
    // Never set an absolute `remaining` — QuotaTable reads that field as a 0-100
    // percentage (the same reason deepseek.js omits it).
    const remainingPercentage =
      limit > 0 ? Math.min(100, Math.max(0, (remaining / limit) * 100)) : 0;

    return {
      plan,
      quotas: {
        [period ? `Credits (USD, ${period})` : "Credits (USD)"]: {
          used,
          total: limit,
          remainingPercentage,
          resetAt: null,
          unlimited: false,
        },
      },
    };
  } catch (error) {
    return { message: `OpenRouter error: ${error.message}` };
  }
}
