// Quota auto-ping scheduler: warms 5h windows by sending tiny opt-in requests right after reset.
import "open-sse/index.js";

import {
  getSettings,
  getProviderConnections,
  updateProviderConnection,
} from "@/lib/localDb";
import * as localDb from "@/lib/localDb";
import { getClaudeUsage } from "open-sse/services/usage/claude.js";
import { getCodexUsage } from "open-sse/services/usage/codex.js";
import { getAntigravityUsage } from "open-sse/services/usage/google.js";
import { getExecutor } from "open-sse/executors/index.js";
import { CLAUDE_CLI_SPOOF_HEADERS } from "open-sse/providers/shared.js";
import { PROVIDER_MODELS } from "open-sse/providers/index.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { resolveConnectionProxyConfig, toConnectionProxyOptions } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "@/app/api/usage/[connectionId]/route.js";
import { QUOTA_AUTOPING_CONFIG } from "@/shared/constants/config";

const C = QUOTA_AUTOPING_CONFIG;
const CLAUDE_PING_URL = "https://api.anthropic.com/v1/messages?beta=true";

const providerHandlers = {
  claude: {
    getUsage: getClaudeUsage,
    sendPing: sendClaudePing,
  },
  codex: {
    getUsage: getCodexUsage,
    sendPing: sendCodexPing,
  },
  antigravity: {
    // The dispatcher calls getUsage(accessToken, proxyOptions); this one takes
    // (accessToken, providerSpecificData, proxyOptions, hooks), so it is adapted
    // here rather than bending the call for two providers that do not need it.
    // providerSpecificData goes unread by that function, and hooks drives the
    // account-verification reporter, which an unattended timer must not trigger.
    getUsage: (accessToken, proxyOptions) => getAntigravityUsage(accessToken, null, proxyOptions, null),
    sendPing: sendAntigravityPing,
  },
};

// Survive Next.js hot reload and keep one scheduler per server process.
const g = (global.__quotaAutoPing ??= {
  interval: null,
  running: false,
  resetCache: {},
  failureCache: {},
});

function cacheKey(provider, connectionId) {
  return `${provider}:${connectionId}`;
}

function normalizeResetKey(resetAt) {
  const ms = new Date(resetAt).getTime();
  if (!Number.isFinite(ms)) return resetAt;
  return new Date(Math.floor(ms / 60000) * 60000).toISOString();
}

function getResetDriftMs(previousResetAt, nextResetAt) {
  const previousMs = new Date(previousResetAt).getTime();
  const nextMs = new Date(nextResetAt).getTime();
  if (!Number.isFinite(previousMs) || !Number.isFinite(nextMs)) return 0;
  return nextMs - previousMs;
}

function toFiniteNumber(value, fallback = null) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function isQuotaExhausted(quota) {
  if (!quota || quota.unlimited === true) return false;
  const remaining = toFiniteNumber(quota.remaining);
  if (remaining !== null) return remaining <= 0;

  const used = toFiniteNumber(quota.used);
  const total = toFiniteNumber(quota.total);
  return total !== null && total > 0 && used !== null && used >= total;
}

function wasPingedRecently(connection, intervalMs, nowMs = Date.now()) {
  if (!intervalMs) return false;
  const lastPingAtMs = new Date(connection.lastPingAt).getTime();
  return Number.isFinite(lastPingAtMs) && nowMs - lastPingAtMs < intervalMs;
}

function isBlockingQuotaName(name, sessionKey) {
  if (name === sessionKey) return false;
  return !String(name).toLowerCase().includes("session");
}

function hasExhaustedBlockingQuota(quotas, sessionKey) {
  return Object.entries(quotas || {}).some(([name, quota]) => isBlockingQuotaName(name, sessionKey) && isQuotaExhausted(quota));
}

// Claude and Codex each meter one named window, so `quotaKey` is a literal.
// Antigravity meters per MODEL: its quota map is keyed by the registry model id,
// one window per quota family, so a provider may name a SET via `quotaKeys`.
// The governing reset is the EARLIEST of them — the next window to roll over,
// which is the deadline that decides when this connection is next pinged.
// The single-key path stays a plain lookup, so Claude and Codex are untouched.
export function resolveQuotaEntry(quotas, providerConfig) {
  const keys = providerConfig.quotaKeys || [providerConfig.quotaKey];
  if (keys.length === 1) return quotas?.[keys[0]];

  let governing = null;
  let governingMs = Infinity;
  for (const key of keys) {
    const quota = quotas?.[key];
    const resetMs = new Date(quota?.resetAt).getTime();
    if (!Number.isFinite(resetMs) || resetMs >= governingMs) continue;
    governing = quota;
    governingMs = resetMs;
  }
  return governing;
}

function shouldPingForReset(providerConfig, cachedReset, resetAt, now) {
  if (providerConfig.pingWhenResetAtSlides) {
    return Boolean(cachedReset) && getResetDriftMs(cachedReset, resetAt) >= (providerConfig.resetAtDriftMs || 0);
  }

  const resetMs = new Date(resetAt).getTime();
  return Number.isFinite(resetMs) && now >= resetMs - C.pingLeadMs;
}

function buildProxyOptions(cfg) {
  if (cfg?.kind === "usable") return toConnectionProxyOptions(cfg);
  return {
    connectionProxyEnabled: cfg.connectionProxyEnabled === true,
    connectionProxyUrl: cfg.connectionProxyUrl || "",
    connectionNoProxy: cfg.connectionNoProxy || "",
    vercelRelayUrl: cfg.vercelRelayUrl || "",
    strictProxy: cfg.strictProxy === true,
  };
}

function snapshotOwner(conn, deps) {
  const data = conn.providerSpecificData || {};
  return {
    persistPoolSnapshot: data.proxyPoolId && typeof deps.updateConnectionProxyPoolSnapshotIfBound === "function"
      ? (pair) => deps.updateConnectionProxyPoolSnapshotIfBound(conn.id, data.proxyPoolId, pair)
      : undefined,
  };
}

// The models this fork routes for Claude, cheapest last so the ping costs as
// little as possible when the configured one is refused.
export function claudePingCandidates(providerConfig) {
  // PROVIDER_MODELS is keyed by the registry ALIAS where one exists, and the
  // Claude entry aliases to "cc", so keying on the provider id alone finds
  // nothing and the walk would have no candidates at all.
  const registry = (PROVIDER_MODELS.cc || PROVIDER_MODELS.claude || [])
    .map((m) => m?.id)
    .filter(Boolean);
  const cheapestFirst = [
    ...registry.filter((id) => id.includes("haiku")),
    ...registry.filter((id) => !id.includes("haiku")),
  ];
  return [providerConfig.pingModel, ...cheapestFirst].filter(
    (id, i, all) => id && all.indexOf(id) === i,
  );
}

// A 404, or a 400 whose message names the model, means THIS model is refused for
// this account and another may work. A 401, 403 or 429 is about the account or
// the rate limiter and must never make us walk the catalogue.
export function isClaudeModelRejection(status, bodyText) {
  if (status === 404) return true;
  if (status !== 400) return false;
  return /model/i.test(bodyText || "");
}

async function sendClaudePing(connection, providerConfig, proxyOptions, deps) {
  const candidates = claudePingCandidates(providerConfig);
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i];
    const res = await deps.proxyAwareFetch(CLAUDE_PING_URL, {
      method: "POST",
      headers: {
        ...CLAUDE_CLI_SPOOF_HEADERS,
        "Authorization": `Bearer ${connection.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: providerConfig.pingMaxTokens,
        messages: [{ role: "user", content: providerConfig.pingText }],
      }),
    }, proxyOptions);
    if (res.ok) {
      if (i > 0) console.log(`[AutoPing] claude: ${candidates[0]} refused, pinged with ${model}`);
      return true;
    }
    // The configured model erroring used to end the tick, so the window was
    // never warmed and the countdown never started, with nothing said about why
    // (#2592). Walk to the next model instead, but only when the refusal is
    // about the model.
    const bodyText = await res.text?.().catch(() => "") || "";
    if (!isClaudeModelRejection(res.status, bodyText)) {
      console.log(`[AutoPing] claude: ping failed with ${res.status}, not retrying another model`);
      return false;
    }
    if (i === candidates.length - 1) {
      console.log(`[AutoPing] claude: every candidate model was refused (last ${res.status})`);
    }
  }
  return false;
}

function buildCodexPingInput(text) {
  return [{
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
  }];
}

async function drainResponseBody(response) {
  if (typeof response?.text === "function") {
    await response.text();
    return;
  }

  const reader = response?.body?.getReader?.();
  if (!reader) return;

  try {
    while (true) {
      const { done } = await reader.read();
      if (done) return;
    }
  } finally {
    reader.releaseLock?.();
  }
}

// Codex model access is per-account and moves over time, so a model fixed in
// config can be unavailable for an otherwise valid account (#3212). Ask the
// account's own catalog instead of inferring access from a Free/Plus/Pro label.
// Duplicated from src/app/api/providers/[id]/models/route.js, which owns the
// canonical copy but does not export it; the client_version must stay in step
// with it, because the endpoint silently omits entries gated above it.
const CODEX_MODELS_URL = "https://chatgpt.com/backend-api/codex/models?client_version=0.144.6";

/**
 * Pick the model to ping from a Codex model catalog.
 *
 * @returns {string} the selected model id,
 *          `null` when the catalog is readable but offers nothing callable
 *          (the account genuinely cannot ping — do not spend a request), or
 *          `undefined` when the payload is not a catalog at all (unknown, so
 *          the caller keeps the configured model rather than guessing).
 */
export function selectCodexPingModel(catalog) {
  const entries = Array.isArray(catalog) ? catalog
    : Array.isArray(catalog?.models) ? catalog.models
    : Array.isArray(catalog?.data) ? catalog.data
    : null;
  if (!entries) return undefined;

  // Catalog order IS the preference order; `is_default` only overrides it when
  // the endpoint states one. Entries are filtered on the endpoint's own
  // supported_in_api flag, absent meaning supported.
  const usable = entries.filter((m) => m && m.supported_in_api !== false);
  const chosen = usable.find((m) => m.is_default === true) || usable[0];
  if (!chosen) return null;
  const id = chosen.slug || chosen.id || chosen.model || chosen.name;
  return typeof id === "string" && id ? id : null;
}

// Fetched only once a ping is actually about to be sent (every skip guard in
// pingConnection has already passed), so this costs one GET per 5h window per
// account rather than one per scheduler tick.
async function resolveCodexPingModel(connection, providerConfig, proxyOptions, deps) {
  try {
    const res = await deps.proxyAwareFetch(CODEX_MODELS_URL, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${connection.accessToken}`,
        "originator": "codex_cli_rs",
      },
    }, proxyOptions);
    if (!res?.ok) return providerConfig.pingModel;
    const selected = selectCodexPingModel(await res.json());
    return selected === undefined ? providerConfig.pingModel : selected;
  } catch {
    // Catalog unreachable is not evidence the model is gone — keep the
    // configured one so a transient failure cannot disable auto-ping.
    return providerConfig.pingModel;
  }
}

async function sendCodexPing(connection, providerConfig, proxyOptions, deps) {
  const pingModel = await resolveCodexPingModel(connection, providerConfig, proxyOptions, deps);
  // The catalog answered and listed nothing this account can call in the API.
  // Reported as a failed ping so the cooldown backs off instead of retrying
  // the same doomed request every tick.
  if (!pingModel) return false;

  const executor = deps.getExecutor("codex");
  const { response } = await executor.execute({
    model: pingModel,
    stream: true,
    credentials: {
      accessToken: connection.accessToken,
      connectionId: connection.id,
      providerSpecificData: connection.providerSpecificData,
    },
    proxyOptions,
    log: console,
    body: {
      model: pingModel,
      input: buildCodexPingInput(providerConfig.pingText),
      instructions: providerConfig.pingInstructions,
      reasoning: providerConfig.pingReasoningEffort
        ? { effort: providerConfig.pingReasoningEffort, summary: "auto" }
        : undefined,
      store: false,
      stream: true,
    },
  });
  if (!response.ok) {
    try { await response.body?.cancel?.(); } catch { /* noop */ }
    return false;
  }

  // Codex only starts the 5h window after the streaming response completes.
  await drainResponseBody(response);
  return true;
}

// A 401, 403 or 429 is about the ACCOUNT or the limiter, never about this one
// model, so the remaining quota families are left alone: poking them would be
// one more request at an endpoint that is already refusing this account.
export function isAntigravityAccountRefusal(status) {
  return status === 401 || status === 403 || status === 429;
}

// Antigravity's countdown only starts once a window is actually used, and each
// quota family has its own window, so this pokes one model from EVERY family
// rather than only the family that governed the schedule. Two families sharing a
// reset timestamp share a reset key, so a single governing poke would leave the
// other one cold for good.
//
// Any other status counts as warmed. The poke's goal is that the request reaches
// upstream and spends a token, not that it comes back 2xx: Google's transport
// commonly answers 5xx or drops the stream after processing the request. Same
// reading as the manual hot reload in
// src/app/api/providers/[id]/hotreload/route.js:31-37.
async function sendAntigravityPing(connection, providerConfig, proxyOptions, deps) {
  const executor = deps.getExecutor("antigravity");
  const models = providerConfig.quotaKeys || [];
  let landed = 0;

  for (const model of models) {
    try {
      const { response } = await executor.execute({
        model,
        stream: true,
        credentials: {
          accessToken: connection.accessToken,
          projectId: connection.projectId,
          email: connection.email || connection.name,
          connectionId: connection.id,
          providerSpecificData: connection.providerSpecificData,
        },
        proxyOptions,
        log: console,
        body: {
          model,
          request: {
            contents: [{ role: "user", parts: [{ text: providerConfig.pingText }] }],
            generationConfig: { maxOutputTokens: providerConfig.pingMaxTokens, temperature: 0 },
          },
        },
      });
      if (!response) continue;

      const status = response.status;
      await drainResponseBody(response);
      if (isAntigravityAccountRefusal(status)) {
        console.log(`[AutoPing] antigravity: ${model} refused with ${status}, leaving the other quota families alone`);
        break;
      }
      landed += 1;
    } catch (e) {
      console.log(`[AutoPing] antigravity: ${model} ping errored: ${e.message}`);
    }
  }

  // A partial success still counts. Failing the whole tick would put the
  // connection on the failure cooldown and re-poke the family that DID answer
  // every 15min, for a model this account may simply not be entitled to.
  if (landed > 0 && landed < models.length) {
    console.log(`[AutoPing] antigravity: ${landed}/${models.length} quota families warmed`);
  }
  return landed > 0;
}

function shouldSkipAfterFailure(state, key, nowMs = Date.now()) {
  const failedAt = state.failureCache[key];
  return failedAt && nowMs - failedAt < C.failureCooldownMs;
}

async function markRateLimitedUntil(connection, resetAt, provider, deps) {
  if (connection.rateLimitedUntil === resetAt) return;
  try {
    await deps.updateProviderConnection(connection.id, { rateLimitedUntil: resetAt });
    console.log(`[AutoPing] ${provider}:${connection.id}: quota exhausted, skipped until ${resetAt}`);
  } catch (e) {
    // Never fail a poll tick over bookkeeping; the next tick retries.
    console.warn(`[AutoPing] ${provider}:${connection.id}: could not record exhausted quota: ${e.message}`);
  }
}

async function pingConnection(conn, provider, providerConfig, handler, deps, state = g) {
  const key = cacheKey(provider, conn.id);

  // resetAt is stable for time-based windows; Codex polls every tick because inactive windows slide forward.
  const cachedReset = state.resetCache[key];
  if (!providerConfig.pingWhenResetAtSlides && cachedReset && Date.now() < new Date(cachedReset).getTime() - C.refreshAheadMs) return;

  // Avoid hammering provider auth/quota endpoints if a ping failed recently.
  if (shouldSkipAfterFailure(state, key)) return;

  const proxyCfg = await deps.resolveConnectionProxyConfig(conn.providerSpecificData, snapshotOwner(conn, deps));
  if (proxyCfg?.kind === "required-unavailable") {
    state.failureCache[key] = Date.now();
    console.warn(`[AutoPing] ${provider}:${conn.id}: required_proxy_unavailable`);
    return { code: "required_proxy_unavailable", status: 503 };
  }
  const proxyOptions = buildProxyOptions(proxyCfg);

  let connection = conn;
  try {
    const r = await deps.refreshAndUpdateCredentials(connection, false, proxyOptions);
    connection = r.connection;
  } catch (e) {
    state.failureCache[key] = Date.now();
    console.warn(`[AutoPing] ${provider}:${conn.id}: refresh failed: ${e.message}`);
    return;
  }

  const usage = await handler.getUsage(connection.accessToken, proxyOptions);
  const quotas = usage?.quotas || {};
  const quota = resolveQuotaEntry(quotas, providerConfig);
  const resetAt = quota?.resetAt;
  if (!resetAt) return;

  state.resetCache[key] = resetAt;

  if (providerConfig.skipWhenBlockingQuotaExhausted && hasExhaustedBlockingQuota(quotas, providerConfig.quotaKey)) return;
  if (isQuotaExhausted(quota)) {
    // The poller is the only thing that KNOWS the account is spent before a real
    // request finds out the hard way. Returning here left that knowledge in this
    // function (#1125): selection kept offering the account until an actual
    // request 429'd. `rateLimitedUntil` is the field account fallback already
    // filters on, so writing the reset the provider reported makes the account
    // skipped the same way a paused one is, and it lapses on its own at reset.
    await markRateLimitedUntil(connection, resetAt, provider, deps);
    return;
  }

  const now = Date.now();
  const resetKey = normalizeResetKey(resetAt);
  const lastPingedResetKey = connection.lastPingedResetKey || normalizeResetKey(connection.lastPingedResetAt);

  // Claude waits for reset. Codex pings only when resetAt slides, which means the 5h window is inactive.
  if (!shouldPingForReset(providerConfig, cachedReset, resetAt, now)) return;
  if (wasPingedRecently(connection, providerConfig.minPingIntervalMs, now)) return;
  if (lastPingedResetKey === resetKey) return;

  const ok = await handler.sendPing(connection, providerConfig, proxyOptions, deps);
  if (!ok) {
    // Do not mark reset as pinged unless upstream accepted the tiny request.
    state.failureCache[key] = Date.now();
    console.warn(`[AutoPing] ${provider}:${connection.id}: ping failed (reset ${resetAt})`);
    return;
  }

  delete state.failureCache[key];
  await deps.updateProviderConnection(connection.id, {
    lastPingedResetAt: resetAt,
    lastPingedResetKey: resetKey,
    lastPingAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  console.log(`[AutoPing] ${provider}:${connection.id}: ping sent (reset ${resetAt})`);
}

function createDefaultDeps() {
  return {
    getSettings,
    getProviderConnections,
    updateConnectionProxyPoolSnapshotIfBound: localDb.updateConnectionProxyPoolSnapshotIfBound,
    updateProviderConnection,
    resolveConnectionProxyConfig,
    refreshAndUpdateCredentials,
    proxyAwareFetch,
    getExecutor,
  };
}

export async function runQuotaAutoPingTick(deps = createDefaultDeps(), state = g) {
  if (state.running) return;
  state.running = true;
  try {
    const settings = await deps.getSettings();

    for (const [provider, providerConfig] of Object.entries(C.providers)) {
      const handler = providerHandlers[provider];
      if (!handler) continue;

      const enabledMap = settings?.[providerConfig.settingsKey]?.connections || {};
      if (Object.keys(enabledMap).length === 0) continue;

      const conns = await deps.getProviderConnections({ provider, isActive: true });
      const targets = conns.filter((conn) => conn.authType === "oauth" && enabledMap[conn.id] === true);
      for (const conn of targets) {
        try {
          await pingConnection(conn, provider, providerConfig, handler, deps, state);
        } catch (e) {
          state.failureCache[cacheKey(provider, conn.id)] = Date.now();
          console.warn(`[AutoPing] ${provider}:${conn.id}: ${e.message}`);
        }
      }
    }
  } catch (e) {
    console.warn("[AutoPing] tick error:", e.message);
  } finally {
    state.running = false;
  }
}

export function startQuotaAutoPing() {
  if (g.interval) return;
  console.log("[AutoPing] scheduler started");
  runQuotaAutoPingTick().catch(() => {});
  g.interval = setInterval(() => { runQuotaAutoPingTick().catch(() => {}); }, C.tickIntervalMs);
  if (g.interval.unref) g.interval.unref();
}

export function stopQuotaAutoPing() {
  if (!g.interval) return;
  clearInterval(g.interval);
  g.interval = null;
  console.log("[AutoPing] scheduler stopped");
}

export function configureQuotaAutoPing(settings) {
  const enabled = Object.values(C.providers).some((providerConfig) =>
    Object.values(settings?.[providerConfig.settingsKey]?.connections || {}).some(Boolean)
  );
  if (enabled) startQuotaAutoPing();
  else stopQuotaAutoPing();
}
