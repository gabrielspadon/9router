import "open-sse/index.js";

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
  isValidApiKey,
} from "../services/auth.js";
import { resolveClientApiKey } from "@/lib/auth/clientApiKey";
import { getSettings } from "@/lib/localDb";
import { isInternalModelTestAuthorized } from "@/lib/auth/internalCliToken";
import { getModelInfo, getComboModels, isModelDisabled } from "../services/model.js";
import { getReachableProviders } from "../services/auth.js";
import { handleChatCore } from "open-sse/handlers/chatCore.js";
import { DEFAULT_HEADROOM_URL, parseHeadroomTimeoutMs } from "@/lib/headroom/detect";
import { getTransform as getPxpipeTransform } from "@/lib/pxpipe/loader.js";
import { appendPxpipeEvent } from "@/lib/pxpipe/events.js";
import { appendTokenSaverEvent } from "@/lib/tokenSaver/events.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { handleComboChat, handleFusionChat, detectRequiredCapabilities, resolveComboMemberConnection, resolveComboTokenSaver } from "open-sse/services/combo.js";
import { AUTO_MODEL_IDS, resolveAutoModel } from "@/sse/services/autoRouter.js";
import { detectAgentRole, applyAgentRoleGroup } from "open-sse/utils/agentRole.js";
import { refuseDisallowedModel } from "@/sse/services/modelAccess.js";
import { augmentModelsWithCapacityAdapter, withCapacityAdapterStripping, getActiveAdapterStrategy } from "open-sse/services/capacityAdapter.js";
import { handleBypassRequest } from "open-sse/utils/bypassHandler.js";
import { isRequestReplayBufferError } from "open-sse/services/accountFallback.js";
import { peekStreamForContent } from "open-sse/utils/streamContent.js";
import { getActiveRequests } from "@/lib/usageDb.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { EMPTY_CONTENT_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import { detectFormatByEndpoint } from "open-sse/translator/formats.js";
import * as log from "../utils/logger.js";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.js";
import { getProjectIdForConnection } from "open-sse/services/projectId.js";
import { looksLikeClaudeWrappedModel,
  stripContextSuffix, normalizeClaudeModelName, buildClaudeRoutingIndex, readClaudeCompat } from "@/lib/claudeCompat";
import { recordApiKeyDevice } from "@/sse/services/apiKeyDevices.js";

async function createAntigravityVerificationHooks(connectionId) {
  const { createAntigravityVerificationHooks: createHooks } = await import("@/lib/antigravityVerification");
  return createHooks(connectionId);
}

// Simple in-memory sliding-window rate limiter to stop abuse of the expensive AI calls below
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const rateLimitHits = new Map();
const CLIENT_CREDENTIAL_HEADER_NAMES = new Set([
  "authorization",
  "x-api-key",
  "x-goog-api-key",
]);

let lastRateLimitSweep = Date.now();

// Entries were only ever added: one per api key or client IP, kept for the
// process lifetime even after that caller went away. A gateway left running for
// days therefore grew this map without bound, which is the linear memory growth
// reported in #1245. Sweeping keys whose whole window has gone quiet bounds it
// to the callers actually seen in the last window; once per window keeps the
// scan cost negligible next to the request it rides on.
function sweepRateLimitHits(now) {
  if (now - lastRateLimitSweep < RATE_LIMIT_WINDOW_MS) return;
  lastRateLimitSweep = now;
  for (const [k, timestamps] of rateLimitHits) {
    const newest = timestamps[timestamps.length - 1];
    if (newest === undefined || now - newest >= RATE_LIMIT_WINDOW_MS) rateLimitHits.delete(k);
  }
}

function isRateLimited(key) {
  const now = Date.now();
  sweepRateLimitHits(now);
  const timestamps = (rateLimitHits.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) return true;
  timestamps.push(now);
  rateLimitHits.set(key, timestamps);
  return false;
}

// Test seam: the limiter is a process-wide singleton, so a suite needs a way to
// drive it and start from empty without reaching into the map.
export const __rateLimiter = {
  isRateLimited,
  size: () => rateLimitHits.size,
  reset: () => {
    rateLimitHits.clear();
    lastRateLimitSweep = Date.now();
  },
};

function withoutClientCredentialHeaders(clientRawRequest) {
  if (!clientRawRequest?.headers) return clientRawRequest;
  const entries = clientRawRequest.headers instanceof Headers
    ? clientRawRequest.headers.entries()
    : Object.entries(clientRawRequest.headers);
  const headers = Object.fromEntries(
    [...entries].filter(([name]) => !CLIENT_CREDENTIAL_HEADER_NAMES.has(String(name).toLowerCase())),
  );
  return { ...clientRawRequest, headers };
}

/**
 * Handle chat completion request
 * Supports: OpenAI, Claude, Gemini, OpenAI Responses API formats
 * Format detection and translation handled by translator
 */
export async function handleChat(request, clientRawRequest = null, options = {}) {
  const resolvedApiKey = await resolveClientApiKey(request, isValidApiKey);
  const presentedApiKey = resolvedApiKey.apiKey;
  const apiKey = resolvedApiKey.valid ? presentedApiKey : null;
  const rateLimitKey = apiKey || request.headers.get("x-forwarded-for") || "anonymous";
  if (isRateLimited(rateLimitKey)) {
    log.warn("CHAT", "Rate limit exceeded");
    return errorResponse(HTTP_STATUS.RATE_LIMITED, "Too many requests, please slow down");
  }

  let body = options.body;
  if (body === undefined) {
    try {
      body = await request.json();
    } catch {
      log.warn("CHAT", "Invalid JSON body");
      return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
    }
  }
  const callerSignal = options.signal || request?.signal;

  // Build clientRawRequest for logging (if not provided)
  if (!clientRawRequest) {
    const url = new URL(request.url);
    clientRawRequest = {
      endpoint: url.pathname,
      body,
      headers: Object.fromEntries(request.headers.entries())
    };
  }
  clientRawRequest = withoutClientCredentialHeaders(clientRawRequest);
  let modelStr = body.model;

  // Request summary is emitted as the unified "▶" line in chatCore (has fmt/thinking/account)

  // Log API key (masked)
  if (apiKey) {
    const masked = log.maskKey(apiKey);
    log.debug("AUTH", `API Key: ${masked}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  // Enforce API key if enabled in settings, or forced by the environment.
  //
  // REQUIRE_API_KEY appeared in .env.example and the deployment docs while no
  // code read it, so an operator who set it believed the gate was on and it was
  // not (#2834). It is honoured here, and it can only TIGHTEN: the env var adds
  // the requirement, and there is deliberately no value of it that removes one
  // the stored setting imposes. A container operator has no dashboard to click,
  // which is why the env var has to work at all.
  const settings = await getSettings();
  const requireApiKey = settings.requireApiKey || process.env.REQUIRE_API_KEY === "true";
  if (requireApiKey) {
    const authorized = await isInternalModelTestAuthorized(request, apiKey, isValidApiKey);
    if (!authorized) {
      const message = presentedApiKey ? "Invalid API key" : "Missing API key";
      log.warn("AUTH", `${message} (requireApiKey=true)`);
      return errorResponse(HTTP_STATUS.UNAUTHORIZED, message);
    }
    // Count the distinct clients on this key, so a leaked or shared key is
    // visible as more than a bigger bill (#930). Only a VALIDATED key is
    // recorded: counting unchecked strings would let anyone grow the map.
    recordApiKeyDevice(apiKey, request);
  }

  if (!modelStr) {
    log.warn("CHAT", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");
  }

  // Claude compat layer: Anthropic clients echo back ids like
  // "claude-bai/deepseek-v4-flash[1m]" from our rewritten /v1/models. Strip
  // the markers back to the routable name before combo/account selection so
  // the whole pipeline (and usage records) sees the real model.
  // The [1m] marker is tokenproxy's own, so strip it whatever the compat toggle
  // says. A client caches the model list, so an id minted while compat was on
  // is still echoed back after it is turned off, and forwarding the suffix
  // verbatim gives a 404 that reads as a missing model. The rest of the
  // rewrite (the claude- prefix and routing-index resolution) stays gated.
  const unsuffixed = stripContextSuffix(modelStr);
  if (unsuffixed !== modelStr) {
    log.info("CHAT", `Context suffix: "${modelStr}" -> "${unsuffixed}"`);
    body.model = unsuffixed;
    modelStr = unsuffixed;
  }

  if (
    looksLikeClaudeWrappedModel(modelStr) &&
    process.env.DISABLE_CLAUDE_COMPAT !== "true"
  ) {
    const compat = readClaudeCompat(settings);
    if (compat.enabled) {
      const normalized = normalizeClaudeModelName(modelStr, await buildClaudeRoutingIndex());
      if (normalized !== modelStr) {
        log.info("CHAT", `Claude compat: "${modelStr}" -> "${normalized}"`);
        body.model = normalized;
        modelStr = normalized;
      }
    }
  }

  // The key's model allowlist (#1154) was only ever enforced in rerank, so
  // every other modality could reach a barred model with the same key
  // (#448, #2833). Checked once modelStr is final and the key is valid,
  // and before any upstream work or rotation slot is spent.
  const barred = await refuseDisallowedModel(apiKey, modelStr, log);
  if (barred) return barred;

  // A disabled model vanished from /v1/models but still answered when asked
  // for by name, because getModelInfo never consulted the disabled list
  // (#577). Combos were already handled by #1521; this is the direct path.
  // Skipped for a combo name, which has no alias/model shape and whose
  // members are filtered later.
  if (await isModelDisabled(modelStr)) {
    log.warn("CHAT", `Disabled model requested: ${modelStr}`);
    return errorResponse(HTTP_STATUS.NOT_FOUND, `Model is disabled: ${modelStr}`);
  }

  // Bypass naming/warmup requests before combo rotation to avoid wasting rotation slots
  const userAgent = request?.headers?.get("user-agent") || "";
  const bypassResponse = handleBypassRequest(body, modelStr, userAgent, !!settings.ccFilterNaming);
  if (bypassResponse) return bypassResponse.response || bypassResponse;

  // "auto" is a virtual id, not a model: pick a real one from the request and
  // continue down the ordinary path, so combos, the capacity adapter, account
  // fallback and usage all see a normal model string (#1386). A combo the user
  // named "auto" still wins, because a thing they configured outranks a
  // built-in default.
  if (AUTO_MODEL_IDS.has(modelStr) && !(await getComboModels(modelStr))) {
    const routed = await resolveAutoModel(body, settings);
    if (!routed) {
      log.info("CHAT", `Auto router: nothing routable for "${modelStr}"`);
      return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, `No model available to route "${modelStr}" to`);
    }
    log.info("CHAT", `Auto router: ${routed.taskClass} (${routed.source}) -> "${routed.model}"`);
    body.model = routed.model;
    modelStr = routed.model;
  }

  const requiredCapabilities = detectRequiredCapabilities(body);

  // Check if model is a combo (has multiple models with fallback)
  const rawComboModels = await getComboModels(modelStr);
  // A combo is one flat pool, so a sub-agent spawned for an auxiliary task
  // draws from the same top-tier members the main loop does. When the user has
  // assigned a model group to a role, narrow the combo to it, keeping the
  // combo's own order and falling back to the full list if nothing is left
  // (#1092). Inert until a group is configured.
  const agentRole = rawComboModels ? detectAgentRole(body, userAgent) : null;
  const comboModels = rawComboModels
    ? applyAgentRoleGroup(rawComboModels, agentRole, settings)
    : rawComboModels;
  if (comboModels) {
    if (agentRole && comboModels.length !== rawComboModels.length) {
      log.info("CHAT", `Agent role "${agentRole}": combo "${modelStr}" narrowed to ${comboModels.length}/${rawComboModels.length} models`);
    }
    // Check for combo-specific strategy first, fallback to global
    const comboStrategies = settings.comboStrategies || {};
    const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
    const comboStrategy = comboSpecificStrategy || settings.comboStrategy || "fallback";
    const { models: augmentedModels, adapterAdded } = await reachableAugmentation(
      comboModels,
      augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, settings),
    );

    if (comboStrategy === "fusion") {
      log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
      return handleFusionChat({
        body,
        models: comboModels,
        handleSingleModel: (b, m, isPanel) => {
          let cleanRawReq = clientRawRequest;
          if (isPanel && clientRawRequest) {
            const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
            cleanRawReq = { ...clientRawRequest, body: cleanBody };
          }
          return handleSingleModelChat(b, m, cleanRawReq, request, apiKey, new Set([modelStr]), callerSignal);
        },
        log,
        comboName: modelStr,
        judgeModel: comboStrategies[modelStr]?.judgeModel,
        tuning: comboStrategies[modelStr]?.fusionTuning,
      });
    }

    const comboStickyLimit = settings.comboStickyRoundRobinLimit;
    log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
    return handleComboChat({
      body,
      models: augmentedModels,
      handleSingleModel: withCapacityAdapterStripping(
        // Seed the cycle guard with this combo so a member naming it is refused
        // at the first hop rather than the second. See handleSingleModelChat.
        (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey, new Set([modelStr]), callerSignal),
        adapterAdded
      ),
      log,
      comboName: modelStr,
      comboStrategy,
      comboStickyLimit
    });
  }

  // Single model request — may still switch to a capacity-adapter model if the
  // target lacks a capability the request needs (e.g. no vision, request has an image).
  const { models: soloAugmented, adapterAdded } = await reachableAugmentation(
    [modelStr],
    augmentModelsWithCapacityAdapter([modelStr], requiredCapabilities, settings),
  );
  if (soloAugmented.length > 1) {
    log.info("CHAT", `Capacity adapter for [${[...requiredCapabilities].join(",")}] on "${modelStr}" → trying ${soloAugmented.join(", ")}`);
    return handleComboChat({
      body,
      models: soloAugmented,
      handleSingleModel: withCapacityAdapterStripping(
        (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey, null, callerSignal),
        adapterAdded
      ),
      log,
      comboName: modelStr,
      comboStrategy: getActiveAdapterStrategy(requiredCapabilities, settings)
    });
  }

  return handleSingleModelChat(body, modelStr, clientRawRequest, request, apiKey, null, callerSignal);
}

/**
 * Handle single model chat request
 */
// Keep only adapter-pool entries whose provider this install can actually
// reach. The pool is prepended ahead of the requested model, so an entry from a
// provider that was never connected takes the first attempt, fails on missing
// credentials, and logs that failure against a request that never asked for it
// (#2555).
async function reachableAugmentation(base, augmented) {
  const added = augmented.filter((m) => !base.includes(m));
  if (added.length === 0) return { models: augmented, adapterAdded: added };
  const reachable = await getReachableProviders();
  const providerOf = (m) => String(m).split("/")[0];
  const usable = added.filter((m) => reachable.has(providerOf(m)));
  if (usable.length === added.length) return { models: augmented, adapterAdded: added };
  return { models: [...usable, ...base], adapterAdded: usable };
}

// How many requests this provider may have in flight at once, from
// providerStrategies[<provider>].maxConcurrent. Anything that is not a
// positive integer means "no cap", so a malformed setting fails open rather
// than throttling to zero. Returns the refusal text, or null to proceed.
export async function providerConcurrencyOverflow(provider, settings = null) {
  let limit;
  try {
    const s = settings || (await getSettings());
    limit = s?.providerStrategies?.[provider]?.maxConcurrent;
  } catch {
    return null; // fail open: an unreadable setting must not block routing
  }
  if (!Number.isInteger(limit) || limit <= 0) return null;
  let inFlight = 0;
  try {
    for (const r of await getActiveRequests()) {
      if (r.provider === provider) inFlight += r.count;
    }
  } catch {
    return null;
  }
  if (inFlight < limit) return null;
  return `at the configured concurrency limit (${inFlight}/${limit} in flight)`;
}

async function handleSingleModelChat(body, modelStr, clientRawRequest = null, request = null, apiKey = null, comboChain = null, callerSignal = request?.signal) {
  const modelInfo = await getModelInfo(modelStr);

  // If provider is null, this might be a combo name - check and handle
  if (!modelInfo.provider) {
    const comboModels = await getComboModels(modelStr);
    if (comboModels) {
      // Nested combos are deliberate: a member with no provider is expanded as a
      // combo in its own right. Without a cycle guard a combo naming itself, or
      // A listing B while B lists A, recurses until the stack overflows and takes
      // the whole gateway down with it — reachable by anyone who can save a combo
      // (#1235). Refuse to re-enter a combo already being expanded.
      const chain = comboChain || new Set();
      if (chain.has(modelStr)) {
        const cycle = [...chain, modelStr].join(" -> ");
        log.warn("CHAT", `Combo cycle refused: ${cycle}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `Combo "${modelStr}" contains itself (${cycle})`);
      }
      chain.add(modelStr);
      const chatSettings = await getSettings();
      // Check for combo-specific strategy first, fallback to global
      const comboStrategies = chatSettings.comboStrategies || {};
      const comboSpecificStrategy = comboStrategies[modelStr]?.fallbackStrategy;
      const comboStrategy = comboSpecificStrategy || chatSettings.comboStrategy || "fallback";
      const requiredCapabilities = detectRequiredCapabilities(body);
      const { models: augmentedModels, adapterAdded } = await reachableAugmentation(
        comboModels,
        augmentModelsWithCapacityAdapter(comboModels, requiredCapabilities, chatSettings),
      );

      if (comboStrategy === "fusion") {
        log.info("CHAT", `Combo "${modelStr}" with ${comboModels.length} models (strategy: fusion)`);
        return handleFusionChat({
          body,
          models: comboModels,
          handleSingleModel: (b, m, isPanel) => {
            let cleanRawReq = clientRawRequest;
            if (isPanel && clientRawRequest) {
              const { tools, tool_choice, ...cleanBody } = clientRawRequest.body || {};
              cleanRawReq = { ...clientRawRequest, body: cleanBody };
            }
            return handleSingleModelChat(b, m, cleanRawReq, request, apiKey, new Set(chain), callerSignal);
          },
          log,
          comboName: modelStr,
          judgeModel: comboStrategies[modelStr]?.judgeModel,
          tuning: comboStrategies[modelStr]?.fusionTuning,
        });
      }

      const comboStickyLimit = chatSettings.comboStickyRoundRobinLimit;
      log.info("CHAT", `Combo "${modelStr}" with ${augmentedModels.length} models (strategy: ${comboStrategy}, sticky: ${comboStickyLimit})`);
      return handleComboChat({
        body,
        models: augmentedModels,
        handleSingleModel: withCapacityAdapterStripping(
          (b, m) => handleSingleModelChat(b, m, clientRawRequest, request, apiKey, new Set(chain), callerSignal),
          adapterAdded
        ),
        log,
        comboName: modelStr,
        comboStrategy,
        comboStickyLimit
      });
    }
    log.warn("CHAT", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");
  }

  const { provider, model } = modelInfo;

  // Routing shown in the unified "▶" line (client model → provider/model)

  // Per-provider in-flight cap (#2519). Reuses the per-provider settings bag
  // this handler already reads, so there is no new schema:
  // providerStrategies[<provider>].maxConcurrent. The counter is the one
  // chatCore already maintains for the whole stream lifetime, so nothing new
  // has to be released. Over the cap answers 503, which combo and account
  // fallback already read as "try the next candidate" — which is what the
  // report asks for: spread a combo over its members instead of piling every
  // request onto the first one. Unset (the default) skips the lookup entirely.
  const overflow = await providerConcurrencyOverflow(provider);
  if (overflow) {
    log.warn("CHAT", `[${provider}/${model}] ${overflow}`);
    return errorResponse(HTTP_STATUS.SERVICE_UNAVAILABLE, `[${provider}/${model}] ${overflow}`);
  }

  // Extract userAgent from request
  const userAgent = request?.headers?.get("user-agent") || "";

  // Try with available accounts (fallback on errors)
  const excludeConnectionIds = new Set();
  // Per-connection consecutive-failure counter: the SAME account is retried
  // up to ACCOUNT_RETRY_LIMIT times before the loop excludes it and switches.
  const ACCOUNT_RETRY_LIMIT = 3;
  // Above this, the account is genuinely out rather than glitching, so retrying
  // it is wasted time. COOLDOWN.short is 5s and COOLDOWN.long is 2 minutes, so
  // this sits between them and lets a backed-off transient error still retry.
  const SAME_ACCOUNT_RETRY_MAX_COOLDOWN_MS = 30 * 1000;
  const failCountByConn = new Map();
  let lastError = null;
  let lastStatus = null;
  // Envoy request-buffer overflow (507): retry the SAME account once — the
  // failure is upstream buffering, not the account, and other accounts may not
  // hold the credential state the retry needs.
  let requestReplayConnectionId = null;
  let requestReplayAttempted = false;
  // Only a combo member can be pinned, so a plain request never pays the read.
  const pinnedConnectionId = comboChain
    ? resolveComboMemberConnection(comboChain, modelStr, await getSettings())
    : null;
  if (pinnedConnectionId) {
    log.info("CHAT", `[${provider}/${model}] pinned to connection ${pinnedConnectionId.slice(0, 8)}`);
  }

  while (true) {
    if (callerSignal?.aborted) return errorResponse(499, "Request aborted");
    const lastFailedConn = failCountByConn.size ? [...failCountByConn.entries()].find(([id, c]) => c >= 1 && c < ACCOUNT_RETRY_LIMIT)?.[0] : null;
    const credentialOptions = {};
    if (lastFailedConn) credentialOptions.ignoreModelLockConnId = lastFailedConn;
    if (requestReplayConnectionId) credentialOptions.preferredConnectionId = requestReplayConnectionId;
    // A combo may pin this member to one account (#1477): not every account of a
    // provider is equivalent, and a combo built to try a free tier before a paid
    // one cannot say so when selection is provider-wide. Strict on purpose: a
    // user who named an account has chosen it, so falling back to another would
    // spend the wrong subscription. When it is unavailable the member fails and
    // the combo advances, which is what a combo is for. A replay pin, which is
    // about reaching the connection that just failed, still wins.
    else if (pinnedConnectionId) {
      credentialOptions.preferredConnectionId = pinnedConnectionId;
      credentialOptions.strictPreferredConnection = true;
    }
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model, credentialOptions);

    // All accounts unavailable
    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const errorMsg = credentials.lastError || "Unavailable";
        const status = credentials.clientErrorStatus ?? (Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE);
        log.warn("CHAT", `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, credentials.retryAfter, credentials.retryAfterHuman);
      }
      if (excludeConnectionIds.size === 0) {
        log.warn("AUTH", `No active credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.NOT_FOUND, `No active credentials for provider: ${provider}`);
      }
      log.warn("CHAT", "No more accounts available", { provider });
      return errorResponse(lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE, lastError || "All accounts unavailable");
    }

    // Account selection shown in the unified "▶" line (acc:...)
    const refreshedCredentials = await checkAndRefreshToken(provider, credentials);
    const effectiveModel = !modelStr.includes("/") && credentials.defaultModel
      ? credentials.defaultModel
      : model;

    // Ensure real project ID is available for providers that need it (P0 fix: cold miss)
    if ((provider === "antigravity" || provider === "gemini-cli") && !refreshedCredentials.projectId) {
      const projectVerificationHooks = provider === "antigravity"
        ? await createAntigravityVerificationHooks(credentials.connectionId)
        : {};
      const pid = await getProjectIdForConnection(
        credentials.connectionId,
        refreshedCredentials.accessToken,
        provider,
        projectVerificationHooks,
      );
      if (pid) {
        refreshedCredentials.projectId = pid;
        // Persist to DB in background so subsequent requests have it immediately
        updateProviderCredentials(credentials.connectionId, { projectId: pid }).catch(() => { });
      }
    }

    // Use shared chatCore
    const chatSettings = await getSettings();
    // The token saver was global, so a combo mixing an expensive model with a
    // cheap one had to be saved for both or neither (#2289, #2037). The chain
    // names the combo this attempt came from, so a combo's own overrides apply
    // to its members; a combo that declares nothing resolves to the global
    // settings unchanged, and a request outside a combo has no chain at all.
    const comboTokenSaver = resolveComboTokenSaver(comboChain, chatSettings);
    const providerThinking = (chatSettings.providerThinking || {})[provider] || null;
    const connectTimeout = {
      providerOverride: chatSettings.providerStrategies?.[provider]?.connectTimeoutMs,
      globalTimeout: chatSettings.connectTimeoutMs,
    };
    const chatVerificationHooks = provider === "antigravity"
      ? await createAntigravityVerificationHooks(credentials.connectionId)
      : {};
    const result = await handleChatCore({
      body: { ...body, model: `${provider}/${effectiveModel}` },
      modelInfo: { provider, model: effectiveModel },
      credentials: refreshedCredentials,
      callerSignal,
      log,
      clientRawRequest,
      connectionId: credentials.connectionId,
      userAgent,
      apiKey,
      ccFilterNaming: !!chatSettings.ccFilterNaming,
      rtkEnabled: comboTokenSaver.rtkEnabled,
      privacyEnabled: !!chatSettings.privacyFilterEnabled,
      privacyTerms: chatSettings.privacyFilterTerms || [],
      headroomEnabled: comboTokenSaver.headroomEnabled,
      headroomUrl: chatSettings.headroomUrl || DEFAULT_HEADROOM_URL,
      headroomCompressUserMessages: !!chatSettings.headroomCompressUserMessages,
      headroomTimeoutMs: chatSettings.headroomTimeoutMs ?? parseHeadroomTimeoutMs(),
      cavemanEnabled: comboTokenSaver.cavemanEnabled,
      cavemanLevel: chatSettings.cavemanLevel || "full",
      ponytailEnabled: comboTokenSaver.ponytailEnabled,
      ponytailLevel: chatSettings.ponytailLevel || "full",
      pxpipeEnabled: comboTokenSaver.pxpipeEnabled,
      pxpipeMinChars: chatSettings.pxpipeMinChars,
      pxpipeTimeoutMs: chatSettings.pxpipeTimeoutMs,
      // Lazily warms the in-process module on first use; null when not installed (fail-open)
      pxpipeTransform: comboTokenSaver.pxpipeEnabled ? await getPxpipeTransform() : null,
      onPxpipeEvent: appendPxpipeEvent,
      onTokenSaverEvent: appendTokenSaverEvent,
      providerThinking,
      connectTimeout,
      codexFastMode: chatSettings.providerStrategies?.codex?.fastMode === true,
      memorySettings: chatSettings,
      toolDisclosure: (chatSettings.toolDisclosureEnabled || chatSettings.toolDisclosureFilterEnabled) ? {
        disclosureEnabled: !!chatSettings.toolDisclosureEnabled,
        filterEnabled: !!chatSettings.toolDisclosureFilterEnabled,
        maxTools: chatSettings.toolDisclosureMaxTools ?? 20,
        excludeServers: chatSettings.toolDisclosureExcludeServers || [],
        excludeTools: chatSettings.toolDisclosureExcludeTools || [],
      } : null,
      // Detect source format by endpoint + body
      sourceFormatOverride: request?.url ? detectFormatByEndpoint(new URL(request.url).pathname, body) : null,
      verificationContext: chatVerificationHooks.verificationContext,
      onValidationRequired: chatVerificationHooks.onValidationRequired,
      onVerificationSuccess: chatVerificationHooks.onVerificationSuccess,
      onCredentialsRefreshed: async (newCreds) => {
        await updateProviderCredentials(credentials.connectionId, {
          ...newCreds,
          existingProviderSpecificData: credentials.providerSpecificData,
          testStatus: "active"
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(credentials.connectionId, credentials, model);
      },
      // Stream finished with no text/thinking/output tokens (upstream 200'd on
      // nothing). The response already went out to this client — this only
      // locks the account+model so the *next* request (including this
      // client's own empty-stream retry) skips it and falls to the next
      // combo/account candidate, then comes back into rotation once the lock
      // expires.
      onEmptyStream: async () => {
        await markAccountUnavailable(
          credentials.connectionId,
          HTTP_STATUS.BAD_GATEWAY,
          `Empty streaming response from ${provider}/${model}`,
          provider,
          model,
          Date.now() + EMPTY_CONTENT_COOLDOWN_MS
        );
      }
    });

    if (callerSignal?.aborted) return errorResponse(499, "Request aborted");

    // A streaming 200 is not proof of an answer. Combo mode already refuses an
    // empty stream and moves to the next member (peekStreamForContent in
    // open-sse/services/combo.js), and the non-streaming path already refuses
    // one through hasUsefulContent in nonStreamingHandler.js. The SINGLE-model
    // streaming path had neither, so an upstream that opened SSE and closed
    // with nothing was forwarded verbatim and the client waited forever on a
    // stream the log called "complete".
    //
    // That gap is the whole differential in #2535: the built-in model test
    // probes with `stream: false` (src/app/api/models/test/ping.js), so it takes
    // the guarded branch and reports the model healthy while every streaming
    // client hangs. onEmptyStream below fires only after the body has already
    // gone out (see the buildOnStreamComplete docstring in streamingHandler.js)
    // and so protects the NEXT request; peeking here is what gets THIS one
    // retried on another account.
    if (result.success) {
      const peeked = await peekStreamForContent(result.response);
      if (callerSignal?.aborted) return errorResponse(499, "Request aborted");
      if (peeked.hasContent) {
        // Non-SSE replies come back with body:null and pass through as-is.
        return peeked.body
          ? new Response(peeked.body, {
            status: result.response.status,
            statusText: result.response.statusText,
            headers: result.response.headers,
          })
          : result.response;
      }
      const reason = peeked.upstreamError?.reason || "provider returned an empty stream";
      lastError = reason;
      lastStatus = peeked.upstreamError?.status || HTTP_STATUS.SERVICE_UNAVAILABLE;
      log.warn("FALLBACK", `⇄ ACC:${credentials.connectionName} ${reason} → NEXT ACCOUNT`);
      await markAccountUnavailable(
        credentials.connectionId,
        HTTP_STATUS.BAD_GATEWAY,
        `${reason} from ${provider}/${model}`,
        provider,
        model,
        Date.now() + EMPTY_CONTENT_COOLDOWN_MS
      );
      excludeConnectionIds.add(credentials.connectionId);
      continue;
    }

    if (result.clientAborted || result.status === 499) return result.response;
    if (!requestReplayAttempted && isRequestReplayBufferError(result.status, result.error)) {
      requestReplayAttempted = true;
      requestReplayConnectionId = credentials.connectionId;
      log.warn("RETRY", `ACC:${credentials.connectionName} replaying once after upstream request-buffer overflow`);
      continue;
    }

    // Mark account unavailable (auto-calculates cooldown with exponential backoff, or precise resetsAtMs)
    const accountFailureArgs = [
      credentials.connectionId,
      result.status,
      result.error,
      provider,
      model,
      result.resetsAtMs,
    ];
    if (result.failureMetadata) accountFailureArgs.push(result.failureMetadata);
    const { shouldFallback, cooldownMs } = await markAccountUnavailable(...accountFailureArgs);

    if (shouldFallback) {
      lastError = result.error;
      lastStatus = result.status;
      const fails = (failCountByConn.get(credentials.connectionId) || 0) + 1;
      failCountByConn.set(credentials.connectionId, fails);
      // The same-account retry exists for a transient glitch. markAccountUnavailable
      // already computed how long this account is out for, and that answer was
      // being discarded: an account locked for two minutes was still hammered
      // three times in a row before the loop moved on, costing the user two
      // pointless upstream calls and the latency of both (#1641).
      if (fails < ACCOUNT_RETRY_LIMIT && cooldownMs <= SAME_ACCOUNT_RETRY_MAX_COOLDOWN_MS) {
        // Same account, immediate retry — cooldown was skipped for transient
        // errors, so this is a fast re-dispatch rather than a wait.
        log.warn("RETRY", `⇄ ACC:${credentials.connectionName} failed (${result.status}) attempt ${fails}/${ACCOUNT_RETRY_LIMIT} → RETRY SAME`);
        continue;
      }
      if (cooldownMs > SAME_ACCOUNT_RETRY_MAX_COOLDOWN_MS) {
        log.warn("FALLBACK", `⇄ ACC:${credentials.connectionName} locked ${Math.round(cooldownMs / 1000)}s (${result.status}) → NEXT ACCOUNT`);
        excludeConnectionIds.add(credentials.connectionId);
        continue;
      }
      log.warn("FALLBACK", `⇄ ACC:${credentials.connectionName} UNAVAILABLE after ${ACCOUNT_RETRY_LIMIT} tries (${result.status}) → NEXT ACCOUNT`);
      excludeConnectionIds.add(credentials.connectionId);
      continue;
    }

    return result.response;
  }
}
