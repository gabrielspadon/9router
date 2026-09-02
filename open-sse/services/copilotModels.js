/**
 * GitHub Copilot model catalog fetcher.
 *
 * Calls Copilot's `GET /models` endpoint to get the live catalog for an
 * authenticated account, so `/v1/models` reflects what the account can
 * actually use (e.g. newly shipped `claude-opus-4.8`, `gpt-5.5`) instead of
 * the hand-maintained static registry, which inevitably lags behind.
 *
 * Returns chat-capable models the account's policy allows. Embeddings and
 * disabled models are filtered out.
 */

import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { GITHUB_COPILOT } from "../config/appConstants.js";
import { refreshCopilotToken } from "./tokenRefresh.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";

const MODELS_URL = "https://api.githubcopilot.com/models";
// Registry id for the Copilot connection, the key the capability table is under.
const GITHUB_PROVIDER_ID = "github";
const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes per credential

/** @type {Map<string, { expiresAt: number, models: any[] }>} */
const catalogCache = new Map();

function cacheKey(credentials) {
  return credentials?.providerSpecificData?.copilotToken
    || credentials?.accessToken
    || "copilot-anonymous";
}

function buildHeaders(token) {
  return {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
    "Copilot-Integration-Id": "vscode-chat",
    "editor-version": `vscode/${GITHUB_COPILOT.VSCODE_VERSION}`,
    "editor-plugin-version": `copilot-chat/${GITHUB_COPILOT.COPILOT_CHAT_VERSION}`,
    "user-agent": GITHUB_COPILOT.USER_AGENT,
    "x-github-api-version": GITHUB_COPILOT.API_VERSION,
  };
}

async function fetchCatalogRaw(token, signal) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await proxyAwareFetch(MODELS_URL, {
      method: "GET",
      headers: buildHeaders(token),
      cache: "no-store",
      signal: signal || controller.signal,
    });
    if (!response.ok) {
      const err = new Error(`Copilot /models returned ${response.status}`);
      err.status = response.status;
      throw err;
    }
    const data = await response.json();
    return Array.isArray(data?.data) ? data.data : [];
  } finally {
    clearTimeout(timeoutId);
  }
}

// Keep only chat models the account is allowed to use. The static registry
// surfaced disabled/embedding entries inconsistently; here we trust upstream.
function expandCatalog(raw) {
  const seen = new Set();
  const models = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    if (m.capabilities?.type !== "chat") continue;
    if (m.policy && m.policy.state !== "enabled") continue;
    const id = m.id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, name: m.name || id, capabilities: capabilitiesFor(id, m.capabilities) });
  }
  return models;
}

// Copilot states each model's real ceilings in the same response, and dropping
// them left /v1/models with no per-model data for github — so it fell back to
// the static table, which for a Copilot-hosted Anthropic model carries DIRECT
// Claude limits. A client sizing its context from a window Copilot will not
// serve never reaches its own compaction threshold and hard-fails upstream
// (#2756). Layered over the static entry rather than replacing it: Copilot
// publishes limits and vision but says nothing about reasoning or search, and
// the static table is still the only source for those.
function capabilitiesFor(id, upstream) {
  const caps = { ...getCapabilitiesForModel(GITHUB_PROVIDER_ID, id) };
  const limits = upstream?.limits;
  if (limits && typeof limits === "object") {
    const contextWindow = Number(limits.max_context_window_tokens || limits.max_prompt_tokens);
    const maxOutput = Number(limits.max_output_tokens);
    if (Number.isFinite(contextWindow) && contextWindow > 0) caps.contextWindow = contextWindow;
    if (Number.isFinite(maxOutput) && maxOutput > 0) caps.maxOutput = maxOutput;
  }
  if (typeof upstream?.supports?.vision === "boolean") caps.vision = upstream.supports.vision;
  return caps;
}

/**
 * Resolve the live Copilot model catalog for a connection.
 *
 * @param {object} credentials Connection record (accessToken, refreshToken,
 *   providerSpecificData {copilotToken, copilotTokenExpiresAt}).
 * @param {object} [options]
 * @param {boolean} [options.forceRefresh] Bypass the per-credential cache.
 * @param {object}  [options.log] Logger.
 * @param {function} [options.onCredentialsRefreshed] Persist a refreshed
 *   Copilot token back to your store. Called with `{ copilotToken,
 *   copilotTokenExpiresAt }` whenever a 401 triggers a refresh.
 * @returns {Promise<{ models: object[] } | null>}
 */
export async function resolveCopilotModels(credentials, options = {}) {
  const token = credentials?.providerSpecificData?.copilotToken || credentials?.accessToken;
  if (!token) {
    options.log?.debug?.("COPILOT_MODELS", "No copilotToken/accessToken; skipping live fetch");
    return null;
  }

  const key = cacheKey(credentials);
  const now = Date.now();
  if (!options.forceRefresh) {
    const cached = catalogCache.get(key);
    if (cached && cached.expiresAt > now) {
      return { models: cached.models };
    }
  }

  let raw;
  try {
    raw = await fetchCatalogRaw(token, options.signal);
  } catch (err) {
    // A 401/403 means the Copilot token is stale — refresh from the GitHub
    // access token and retry once.
    if (err && (err.status === 401 || err.status === 403) && credentials.accessToken) {
      options.log?.info?.("COPILOT_MODELS", `Got ${err.status}; refreshing Copilot token`);
      const refreshed = await refreshCopilotToken(credentials.accessToken);
      if (refreshed?.token) {
        if (typeof options.onCredentialsRefreshed === "function") {
          try {
            await options.onCredentialsRefreshed({
              copilotToken: refreshed.token,
              copilotTokenExpiresAt: refreshed.expiresAt,
            });
          } catch (e) {
            options.log?.warn?.("COPILOT_MODELS", `onCredentialsRefreshed failed: ${e?.message || e}`);
          }
        }
        try {
          raw = await fetchCatalogRaw(refreshed.token, options.signal);
        } catch (err2) {
          options.log?.warn?.("COPILOT_MODELS", `Retry after refresh failed: ${err2?.message || err2}`);
          return null;
        }
      } else {
        options.log?.warn?.("COPILOT_MODELS", "Token refresh did not return a token");
        return null;
      }
    } else {
      options.log?.warn?.("COPILOT_MODELS", `Live model fetch failed: ${err?.message || err}`);
      return null;
    }
  }

  const models = expandCatalog(raw);
  if (!models.length) return null;

  catalogCache.set(key, { expiresAt: now + CACHE_TTL_MS, models });
  return { models };
}

export function clearCopilotModelCache() {
  catalogCache.clear();
}
