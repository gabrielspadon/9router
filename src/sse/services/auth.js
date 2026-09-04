import {
  getProviderConnections,
  validateApiKey,
  updateProviderConnection,
  updateConnectionProxyPoolSnapshotIfBound,
  updateProviderStrategyProxyPoolSnapshotIfBound,
  getSettings,
  getProxyPools,
} from "@/lib/localDb";
import {
  resolveConnectionProxyConfig,
  toConnectionProxyOptions,
  pickProxyPoolId,
} from "@/lib/network/connectionProxy";
import {
  buildModelFailureUpdate,
  buildModelLockUpdateAt,
  checkFallbackError,
  formatRetryAfter,
  getActiveModelFailure,
  getEarliestModelLockUntil,
  getModelFailureKey,
  getModelLockKey,
  isModelLockActive,
} from "open-sse/services/accountFallback.js";
import { FREE_TIER_RATE_LIMIT_COOLDOWN_MS, MAX_RATE_LIMIT_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import { ACCOUNT_ERROR_MESSAGE_MAX_CHARS } from "open-sse/config/runtimeConfig.js";
import { resolveProviderId, NO_AUTH_PROVIDER_IDS, isNoAuthProvider, isProviderDisabled, FREE_PROVIDERS, FREE_TIER_PROVIDERS } from "@/shared/constants/providers.js";
import { createHash } from "node:crypto";
import { resolveSessionIdentity } from "open-sse/utils/sessionManager.js";
import { readAllDrainDocs } from "@/lib/admin/state.js";
import { evaluateQuota } from "./quotaGuard.js";
import { selectAndReserve } from "./accountScheduler.js";
import { createSchedulerRepos } from "./schedulerRepos.js";
import {
  leaseRegistry,
  registerAccountCapacity,
  releaseAccountLease,
  releaseAccountLeaseOnResponse,
  _getLeaseRegistry,
} from "./accountLeaseRegistry.js";
import { effectiveCapacity } from "@/shared/utils/accountCapacity.js";
import { toRankerWindows } from "@/shared/utils/quotaWindowBridge.js";
import { buildSwitchReceipt } from "@/shared/utils/switchReceipt.js";
import { putWindows } from "@/lib/db/repos/quotaWindowsRepo.js";
import * as log from "../utils/logger.js";
import { collectClientApiKeyCandidates } from "@/lib/auth/clientApiKey";

// Serialize account selection per canonical provider without blocking unrelated providers.
const providerSelectionQueues = new Map();

export function _getProviderSelectionQueueSize() {
  return providerSelectionQueues.size;
}

// overlay-spec §4: a local admission refusal always carries a nonzero
// retry-after, so a caller is never told to retry with no delay hint at all.
// Mirrors accountScheduler.js's own RETRY_AFTER_SECONDS.
const SCHEDULER_RETRY_AFTER_SECONDS = 1;

// The affinity table is keyed by (sessionHash, model) and both are NOT NULL, so
// a request that names no model still needs a key. A sentinel rather than the
// empty string keeps the row legible and keeps a modelless request from sharing
// a pin with a request for a model literally named "".
const MODEL_ANY = "*";

/**
 * The HASH of this request's client session identity — never the raw id.
 *
 * open-sse/utils/sessionManager.js is the single session-identity authority in
 * this codebase, so `resolveSessionIdentity` resolves WHICH session this is and
 * nothing here invents a second scheme. What reaches the affinity table and the
 * switch receipt is sha256 of that id, truncated the same way sessionManager's
 * own `sha16` truncates, so rule 8 holds by construction: a raw session id, a
 * bearer token or a prompt body cannot be written even by mistake, because the
 * only value that leaves this function is a digest.
 *
 * A request that carries no session evidence at all still gets a stable key
 * from the provider node, which pins every anonymous caller of one provider
 * together. That is the honest reading: with no way to tell two callers apart,
 * claiming they are separate sessions would be a fabricated distinction.
 *
 * WHY THE IDENTITY IS RESOLVED TWICE. resolveSessionIdentity never reports "no
 * evidence"; with none it falls through to deriveSessionId(connectionId), and
 * selection has no connection yet by construction, so that arm returns
 * generateBinaryStyleId() — `crypto.randomUUID() + Date.now()`, a DIFFERENT
 * value on every call (sessionManager.js:45 and :81). Hashing that would give
 * every request its own pin: affinity could never hit, and sessionAffinity
 * would gain one dead row per request forever. A client-derived id (a header,
 * a prompt_cache_key, the assistant-text digest) is a pure function of the same
 * inputs, so it reproduces. Comparing two resolutions is therefore the exact
 * test for "did this come from the client", and it needs nothing from
 * sessionManager that is not already exported. An id that does not reproduce
 * carries no session information and is treated as anonymous.
 */
function resolveRoutingSessionHash(options, providerId) {
  let sessionId = null;
  const headers = options?.clientHeaders || null;
  const body = options?.clientBody || null;
  if (headers || body) {
    try {
      const args = { headers, body, scope: providerId };
      const first = resolveSessionIdentity(args);
      // ephemeral is sessionManager's own "this id is disposable" flag (kiro).
      if (!first?.ephemeral && first?.sessionId
          && first.sessionId === resolveSessionIdentity(args)?.sessionId) {
        sessionId = first.sessionId;
      }
    } catch {
      // An identity resolution failure must not fail the request. Falling back
      // to the provider node makes the session read as a shared anonymous one,
      // which still ranks and still pins, rather than throwing inside selection.
      sessionId = null;
    }
  }
  return createHash("sha256")
    .update(`${providerId}:${sessionId || "anonymous"}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Make an OPERATOR pin durable, the way selectAndReserve makes the scheduler's
 * own choice durable.
 *
 * WHY THIS EXISTS. The operator branch below reserved a lease and returned,
 * calling neither setPin nor touchPin, so every request an operator pinned on
 * purpose -- a combo member, a same-request replay, an `x-connection-id` call --
 * left sessionAffinity untouched. A session served entirely through that branch
 * had no durable pin at all, and one that already had a pin could not tell a
 * reused pin from a writer that was never reached. That is the provider-side
 * prompt-cache locality the pin exists to protect, lost for exactly the traffic
 * that asked for it.
 *
 * WHAT IT DOES NOT DO. It does not give the pin a vote. The operator named this
 * account and it has already been chosen by the time this runs; the pin RECORDS
 * that decision so later requests of the same session inherit it, and never
 * overrules it. The three writes mirror accountScheduler.js:139-147 exactly: a
 * first selection sets, a same-account reuse touches lastSeenAt and leaves
 * pinnedAt where decideRepin re-ranks from, and a move off a live pin is a
 * switch, so rule 8 gets its receipt. The `operator-pin` trigger keeps that
 * receipt distinguishable from a ranker-driven `repin` in the audit log.
 *
 * READ AND WRITE INSIDE ONE TRANSACTION, for rule 4's reason: read outside it
 * and a concurrent repin lands between the read and the write, leaving two
 * answers to a question with one answer. The adapter is resolved BEFORE the
 * transaction opens, because db.transaction(fn) is synchronous.
 *
 * FAILURE DIRECTION. Affinity is a locality optimisation, never an admission
 * gate, and the lease is ALREADY held by the time this runs. A throw here would
 * escape getProviderCredentials with a reserved slot nobody downstream knows
 * about, which is the one leak this file otherwise guards against by hand. So a
 * failed write is logged and swallowed: the request proceeds on the account the
 * operator chose, and the session simply reads as new next time.
 */
async function persistOperatorPin({ sessionHash, model, connection, windows, nowMs }) {
  const connectionId = connection?.id;
  if (!sessionHash || !model || !connectionId) return null;
  const at = new Date(nowMs).toISOString();
  try {
    const repos = await createSchedulerRepos({ now: nowMs });
    return repos.transaction(() => {
      const previousPinId = repos.getPin({ sessionHash, model })?.connectionId ?? null;
      if (previousPinId === connectionId) {
        repos.touchPin({ sessionHash, model, at });
        return { reason: "pinned", receipt: null };
      }
      repos.setPin({ sessionHash, model, connectionId, at });
      const trigger = previousPinId === null ? "first-pin" : "operator-pin";
      const receipt = repos.recordSwitch(buildSwitchReceipt({
        from: previousPinId,
        to: connectionId,
        windows: windows || [],
        trigger,
        model,
        sessionHash,
        now: nowMs,
      }));
      return { reason: trigger, receipt };
    });
  } catch (error) {
    log.warn("AUTH", `operator pin not persisted: ${error?.message || error}`);
    return null;
  }
}

// Re-exported so a handler keeps ONE import for "select an account and give
// the slot back". The definitions live in accountLeaseRegistry.js because a
// test that partially mocks this module must not lose the release path.
export { releaseAccountLease, releaseAccountLeaseOnResponse, _getLeaseRegistry };

/**
 * Quota windows in the RANKER's units, persisted so the ranker reads a live
 * table rather than an empty one.
 *
 * `evaluateQuota` already fetched (or cache-read) the provider's usage for its
 * own fail-open pause check, and that read is the only quota evidence in the
 * request path. It emits PERCENTAGES; the ranker needs absolute units. The
 * bridge converts, honestly (a percentage-only provider keeps
 * `confidence: 'unknown'` rather than getting a fabricated total), and the row
 * is written through quotaWindowsRepo.putWindows so a restart, the dashboard
 * and the admin surface all read the same evidence the decision used.
 *
 * Persistence is best-effort and deliberately NOT awaited into the decision: a
 * write failure must never make an account ineligible, which is the same
 * fail-open direction evaluateQuota itself takes.
 */
function persistWindows(connectionId, windows, { hasEvidence = false } = {}) {
  if (!connectionId || !Array.isArray(windows)) return;
  // An EMPTY array is written when, and only when, a quota read actually
  // produced a snapshot and that snapshot held no rankable window. That is
  // itself evidence -- "this account reports nothing the ranker can compare" --
  // and putWindows' delete-then-insert is the only thing that clears a window
  // the provider has stopped reporting. Skipping the write on an empty array
  // left the previous snapshot on disk indefinitely, so the ranker kept
  // comparing a shape the account no longer has: exactly the resurrection
  // putWindows' transaction docstring says it exists to prevent.
  //
  // With NO snapshot at all (ineligible account, required proxy unavailable, a
  // fetch that failed or timed out) nothing was measured, so nothing is
  // written. Erasing good evidence because one read failed is the opposite of
  // the fail-open direction evaluateQuota takes.
  if (windows.length === 0 && !hasEvidence) return;
  putWindows(connectionId, windows).catch(() => {});
}

/**
 * Longest an account of this provider may be benched for a rate limit. A free
 * pool rate-limits on a roughly per-minute window, so both an overlong
 * provider-reported reset and the blind exponential backoff are cut back to that
 * window -- otherwise one burst locks every key in the pool for minutes to hours
 * and selection has nothing left to hand out (#2895). Everything else keeps the
 * global ceiling, which leaves paid providers' resets exactly as they were.
 */
function retryDelayCapMs(provider) {
  if (!provider) return MAX_RATE_LIMIT_COOLDOWN_MS;
  const id = resolveProviderId(provider) || provider;
  return (FREE_PROVIDERS?.[id] || FREE_TIER_PROVIDERS?.[id])
    ? FREE_TIER_RATE_LIMIT_COOLDOWN_MS
    : MAX_RATE_LIMIT_COOLDOWN_MS;
}

const GITHUB_MONTHLY_USAGE_LIMIT = "you've reached your additional usage limit for your plan";
const CODEX_PERMANENT_OAUTH_MARKERS = [
  "invalidated oauth token",
  "authentication token has been invalidated",
  "refresh_token_invalidated",
  "refresh_token_reused",
  "refresh token already used",
];

function githubMonthlyResetMs(status, errorText, provider) {
  if (resolveProviderId(provider) !== "github" || Number(status) !== 402) return null;
  if (!String(errorText || "").toLowerCase().includes(GITHUB_MONTHLY_USAGE_LIMIT)) return null;
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
}

function isCodexPermanentOAuthFailure(status, errorText, provider) {
  if (resolveProviderId(provider) !== "codex" || Number(status) !== 401) return false;
  const reason = describeProviderError(errorText).toLowerCase();
  return CODEX_PERMANENT_OAUTH_MARKERS.some((marker) => reason.includes(marker));
}

/**
 * Detect Qoder account-wide quota exhaustion.
 * Qoder delivers it as an HTTP-200 SSE payload whose first envelope carries
 * statusCodeValue 403 and a body containing "code":"112"; the qoder executor
 * converts that billing block into a plain 403 error before we get here.
 * Unlike transient billing blocks (queue throttle code 10605 / pricingUrl
 * nudges), code 112 does not recover on its own.
 */
function isQoderQuotaExhausted(status, errorText, provider) {
  if (resolveProviderId(provider) !== "qoder" || Number(status) !== 403) return false;
  return /"code"\s*:\s*"112"/.test(String(errorText || ""));
}

/**
 * Get provider credentials from localDb
 * Filters out unavailable accounts and returns the selected account based on strategy
 * @param {string} provider - Provider name
 * @param {Set<string>|string|null} excludeConnectionIds - Connection ID(s) to exclude (for retry with next account)
 * @param {string|null} model - Model name for per-model rate limit filtering
 */
// Providers this install can actually reach right now: one with an active
// connection, or a free provider that needs no auth at all.
//
// The capacity adapter prepends its pool ahead of the model the user asked for,
// because the adapter only fires when nothing requested satisfies a required
// capability. A pool entry whose provider was never connected cannot satisfy
// anything, and attempting it spent one fallback slot and logged
// "No credentials for <provider>" against a request that had nothing to do with
// it, which reads as the router authenticating somewhere it was not asked to
// (#2555). Filter those out before the chain is built rather than after they
// have failed.
export async function getReachableProviders() {
  const reachable = new Set(NO_AUTH_PROVIDER_IDS);
  try {
    for (const connection of await getProviderConnections()) {
      if (connection?.isActive === false) continue;
      if (connection?.provider) reachable.add(resolveProviderId(connection.provider));
    }
  } catch {
    // A repo failure must not take routing down: report nothing reachable and
    // let the normal per-attempt credential lookup produce the real error.
  }
  return reachable;
}

export async function getProviderCredentials(provider, excludeConnectionIds = null, model = null, options = {}) {
  // Normalize to Set for consistent handling
  const excludeSet = excludeConnectionIds instanceof Set
    ? excludeConnectionIds
    : (excludeConnectionIds ? new Set([excludeConnectionIds]) : new Set());
  const preferredConnectionId = options?.preferredConnectionId || null;
  const strictPreferredConnection = Boolean(preferredConnectionId) && options?.strictPreferredConnection === true;
  // Resolve aliases before queue acquisition so alias and canonical requests share one lock.
  const providerId = resolveProviderId(provider);
  const currentQueue = providerSelectionQueues.get(providerId) || Promise.resolve();
  let releaseQueue;
  const nextQueue = new Promise(resolve => { releaseQueue = resolve; });
  providerSelectionQueues.set(providerId, nextQueue);

  try {
    await currentQueue;

    // Inject a virtual connection for no-auth free providers (with optional proxy pool from settings)
    if (isNoAuthProvider(providerId)) {
      const settings = await getSettings();
      // A no-auth provider has no connection row to deactivate, so the operator
      // switch is the only way to bench it. Refuse here rather than in the
      // dashboard: this is the call every modality routes through, and the
      // caller already treats null as "no account, fall through" (#2650).
      if (isProviderDisabled(settings, providerId)) {
        log.warn("AUTH", `${provider} is disabled`);
        return null;
      }
      const override = (settings.providerStrategies || {})[providerId] || {};
      const strategy = override.rotateStrategy || "none";
      let pickedId = override.proxyPoolId || null;
      let pickedPool = null;
      if (strategy !== "none") {
        const allPools = await getProxyPools({ isActive: true });
        const availablePools = allPools.filter(p => p.proxyUrl);
        const poolIds = availablePools.map(p => p.id);
        pickedId = pickProxyPoolId(poolIds, strategy, providerId);
        pickedPool = availablePools.find((pool) => pool.id === pickedId) || null;
      }
      const proxyData = {
        proxyPoolId: pickedId || "",
        ...(strategy === "none" && Object.prototype.hasOwnProperty.call(override, "strictProxy")
          ? { strictProxy: override.strictProxy }
          : {}),
        ...(strategy !== "none" && pickedPool
          ? { strictProxy: pickedPool.strictProxy === true }
          : {}),
      };
      const resolvedProxy = await resolveConnectionProxyConfig(proxyData, {
        persistPoolSnapshot: strategy === "none" && pickedId
          ? (pair) => updateProviderStrategyProxyPoolSnapshotIfBound(providerId, pickedId, pair)
          : undefined,
      });
      if (resolvedProxy.kind !== "usable") return null;
      const proxyOptions = toConnectionProxyOptions(resolvedProxy);
      return {
        id: "noauth",
        // Executors key their upstream session id on connectionId. Without it
        // deriveSessionId() falls through to a fresh random id on every call, so
        // each turn of one conversation reaches the provider as a new session and
        // burns a free-tier slot. "noauth" is the sentinel markAccountUnavailable
        // and clearAccountError already test for.
        connectionId: "noauth",
        connectionName: "Public",
        isActive: true,
        accessToken: "public",
        providerSpecificData: {
          connectionProxyEnabled: proxyOptions.connectionProxyEnabled,
          connectionProxyUrl: proxyOptions.connectionProxyUrl,
          connectionNoProxy: proxyOptions.connectionNoProxy,
          connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
          vercelRelayUrl: proxyOptions.vercelRelayUrl,
          strictProxy: proxyOptions.strictProxy,
          resolutionKind: proxyOptions.resolutionKind,
        },
      };
    }

    const connections = await getProviderConnections({ provider: providerId, isActive: true });
    log.debug("AUTH", `${provider} | total connections: ${connections.length}, excludeIds: ${excludeSet.size > 0 ? [...excludeSet].join(",") : "none"}, model: ${model || "any"}`);

    if (connections.length === 0) {
      log.warn("AUTH", `No credentials for ${provider}`);
      return null;
    }

    // Filter out draining, model-locked and excluded connections.
    // ignoreModelLockConnId: a same-account retry must still reach the just-
    // failed connection (its transient model-lock would otherwise force a
    // switch), so skip the lock check for that one connection only. Draining
    // is checked ahead of that bypass: an operator drain must still exclude
    // the connection from this same-account retry, not just a first attempt.
    //
    // A draining connection is excluded from NEW selection only. An existing
    // session pin or in-flight stream already bound to it is untouched here:
    // selectAndReserve simply finds the pin ineligible against this smaller
    // candidate set and repins to the next eligible account, the same way it
    // already repins around any other account that drops out of eligibility.
    const drainDocs = await readAllDrainDocs();
    const draining = new Set(
      Object.entries(drainDocs || {})
        .filter(([, doc]) => doc?.isDraining)
        .map(([connectionId]) => connectionId)
    );
    const ignoreLockConn = options?.ignoreModelLockConnId || null;
    const availableConnections = connections.filter(c => {
      if (strictPreferredConnection && c.id !== preferredConnectionId) return false;
      if (excludeSet.has(c.id)) return false;
      if (draining.has(c.id)) return false;
      if (c.id === ignoreLockConn) return true;
      if (isModelLockActive(c, model)) return false;
      return true;
    });

    // Filter out accounts paused due to low remaining quota (safety buffer).
    // evaluateQuota is fail-open: a missing/erroring quota read never pauses an
    // account, so this only drops accounts we can actually confirm are below threshold.
    //
    // The same read is the ONLY quota evidence in the request path, so its
    // snapshot is also what the ranker gets: converting it here means one
    // provider fetch answers both questions instead of two. A throw is caught
    // per account, because a quota lookup that fails must never make an account
    // ineligible.
    const nowMs = Date.now();
    const quotaChecked = await Promise.all(
      availableConnections.map(async (c) => {
        let q;
        try {
          q = await evaluateQuota(c);
        } catch {
          // Fail OPEN, explicitly. evaluateQuota swallows its own fetch errors,
          // but a throw from anywhere else in it (a proxy resolution, a repo
          // read) would otherwise reject this Promise.all and take the WHOLE
          // provider down rather than one account.
          return { connection: c, windows: [] };
        }
        if (q.paused) {
          log.info("AUTH", `${provider} | ${c.id?.slice(0, 8)} skipped: quota paused (window below per-window threshold)`);
          return null;
        }
        // Percentage in, absolute units out (quotaWindowBridge.js). An empty
        // array is a valid answer meaning "no usable quota evidence" and is
        // never padded with an invented window.
        //
        // evaluateQuota now fetches evidence whenever the account is eligible
        // and reachable, threshold or no threshold (quotaGuard.js:100-117), so
        // snapshot:null means the read itself found nothing (ineligible, a
        // required proxy unavailable, or a failed/empty fetch) rather than "the
        // pause gate is off". The persisted snapshot the usage route writes
        // (src/app/api/usage/[connectionId]/route.js:208) is the fallback for
        // that case, in the identical shape. q.rawUsage is THIS call's raw
        // payload, paired one-to-one with q.snapshot (quotaGuard.js never hands
        // back one without the other) — forwarding it is what lets the bridge
        // upgrade a window from the synthetic percentage scale to the
        // provider's own absolute remaining/limit.
        const evidence = q.snapshot || c.lastQuotaSnapshot || null;
        const windows = toRankerWindows(evidence, q.rawUsage || null, { now: nowMs });
        persistWindows(c.id, windows, { hasEvidence: Boolean(evidence) });
        return { connection: c, windows };
      })
    );
    const routed = quotaChecked.filter(Boolean);
    const routedConnections = routed.map((r) => r.connection);
    const windowsByConnection = Object.fromEntries(routed.map((r) => [r.connection.id, r.windows]));

    log.debug("AUTH", `${provider} | available: ${routedConnections.length}/${connections.length}`);
    connections.forEach(c => {
      const excluded = excludeSet.has(c.id);
      const isDraining = draining.has(c.id);
      const locked = isModelLockActive(c, model);
      if (excluded || isDraining || locked) {
        const lockUntil = getEarliestModelLockUntil(c, model);
        log.debug("AUTH", `  → ${c.id?.slice(0, 8)} | ${excluded ? "excluded" : ""} ${isDraining ? "draining" : ""} ${locked ? `modelLocked(${model}) until ${lockUntil}` : ""}`);
      }
    });

    if (routedConnections.length === 0) {
      // Find earliest lock expiry across all connections for retry timing
      const lockCandidates = strictPreferredConnection
        ? connections.filter((connection) => connection.id === preferredConnectionId)
        : connections;
      const lockedPairs = lockCandidates
        .map((connection) => ({ connection, failure: getActiveModelFailure(connection, model) }))
        .filter((entry) => entry.failure);
      const selected = lockedPairs.sort((a, b) => a.failure.until.localeCompare(b.failure.until))[0];
      if (selected) {
        const { failure } = selected;
        log.warn("AUTH", `${provider} | all ${connections.length} accounts locked for ${model || "all"} (${formatRetryAfter(failure.until)}) | lastError=${failure.message?.slice(0, 50) || "none"}`);
        return {
          allRateLimited: true,
          retryAfter: failure.until,
          retryAfterHuman: formatRetryAfter(failure.until),
          lastError: failure.message,
          lastErrorCode: failure.status,
          clientErrorStatus: failure.clientErrorStatus,
        };
      }
      log.warn("AUTH", `${provider} | all ${connections.length} accounts unavailable`);
      return null;
    }

    const settings = await getSettings();

    let connection = null;
    let lease = null;
    // Pin to preferred connection if specified and available. This is an
    // OPERATOR pin (a combo member, a replay of the connection that just
    // failed), which is a different fact from the session pin the scheduler
    // owns: the operator named this account, so ranking does not get a vote.
    if (preferredConnectionId) {
      connection = routedConnections.find((c) => c.id === preferredConnectionId) || null;
      if (connection) {
        log.info("AUTH", `${provider} | pinned to ${connection.id?.slice(0, 8)} (${connection.name || connection.email || "unnamed"})`);
      }
    }

    // Register every candidate's capacity before anything reserves, so the
    // registry's capacityOf sees the configured ceiling rather than the
    // fail-open sentinel on this account's first ever selection.
    for (const c of routedConnections) {
      registerAccountCapacity(c.id, effectiveCapacity(c, { settings, provider: providerId }).limit);
    }

    if (connection) {
      // An operator pin still takes a LEASE: rule 7's per-account ceiling is
      // about the account, not about how it was chosen, and skipping the
      // reservation here would let a pinned combo member over-admit while every
      // other path is gated.
      lease = leaseRegistry.reserve(connection.id);
      if (!lease) {
        // At capacity is a WAIT, not a failure (overlay-spec §4): entitlement
        // is free, the slot is not. Reported with a nonzero retry-after through
        // the shape callers already read for "come back later".
        const retryAt = new Date(Date.now() + SCHEDULER_RETRY_AFTER_SECONDS * 1000).toISOString();
        log.info("AUTH", `${provider} | ${connection.id?.slice(0, 8)} at capacity, caller should retry`);
        return {
          allRateLimited: true,
          retryAfter: retryAt,
          retryAfterHuman: `${SCHEDULER_RETRY_AFTER_SECONDS}s`,
          lastError: "Account at capacity",
          lastErrorCode: null,
          clientErrorStatus: null,
        };
      }

      // The slot is proven free and this account WILL serve the request, so the
      // binding is real and gets recorded. Placed after the reservation on
      // purpose: pinning ahead of it would bind a session to an account that
      // refused it.
      const pinned = await persistOperatorPin({
        sessionHash: resolveRoutingSessionHash(options, providerId),
        model: model || MODEL_ANY,
        connection,
        windows: windowsByConnection[connection.id],
        nowMs,
      });
      if (pinned?.receipt) {
        log.info(
          "AUTH",
          `${provider} | affinity ${pinned.reason} → ${connection.id?.slice(0, 8)}`
          + ` from ${pinned.receipt.fromConnectionId?.slice(0, 8) || "none"}`
        );
      }
    } else {
      // The scheduler decides: the ranker orders by expiring entitlement, the
      // durable pin keeps a session on its account while that account stays
      // eligible, and the reservation is what proves a slot was free. There is
      // deliberately no round-robin or fill-first fallback underneath — a
      // silent fall-through to arbitrary order is exactly the failure the
      // durable pin exists to prevent, so a refusal is reported as a wait.
      //
      // The adapter is resolved BEFORE selectAndReserve opens its transaction,
      // because db.transaction(fn) is synchronous (schedulerRepos.js).
      const sessionHash = resolveRoutingSessionHash(options, providerId);
      const repos = await createSchedulerRepos({ now: nowMs });
      const decision = selectAndReserve({
        sessionHash,
        model: model || MODEL_ANY,
        accounts: routedConnections,
        windows: windowsByConnection,
        now: nowMs,
        registry: leaseRegistry,
        repos,
      });

      if (decision?.unavailable) {
        const retryAt = new Date(nowMs + (decision.retryAfter || SCHEDULER_RETRY_AFTER_SECONDS) * 1000).toISOString();
        log.info("AUTH", `${provider} | scheduler: ${decision.reason}, caller should retry`);
        return {
          allRateLimited: true,
          retryAfter: retryAt,
          retryAfterHuman: `${decision.retryAfter || SCHEDULER_RETRY_AFTER_SECONDS}s`,
          lastError: `No account available (${decision.reason})`,
          lastErrorCode: null,
          clientErrorStatus: null,
        };
      }

      connection = decision.connection;
      lease = decision.lease;
      log.info(
        "AUTH",
        `${provider} | ${connection.id?.slice(0, 8)} selected (${decision.reason})`
        + (decision.receipt ? ` from ${decision.receipt.fromConnectionId?.slice(0, 8) || "none"}` : "")
      );
    }

    const connectionProxyData = connection.providerSpecificData || {};
    const expectedPoolId = connectionProxyData.proxyPoolId;
    const resolvedProxy = await resolveConnectionProxyConfig(connectionProxyData, {
      persistPoolSnapshot: expectedPoolId
        ? (pair) => updateConnectionProxyPoolSnapshotIfBound(connection.id, expectedPoolId, pair)
        : undefined,
    });
    if (resolvedProxy.kind !== "usable") {
      // The lease was taken before the proxy was resolved, and this return
      // happens AFTER the reservation, so it is the one exit inside this
      // function that can strand a slot. Release it here: nothing downstream
      // ever learns the lease existed, so nothing downstream can free it.
      leaseRegistry.release(lease);
      return null;
    }
    const proxyOptions = toConnectionProxyOptions(resolvedProxy);

    return {
      authType: connection.authType,
      apiKey: connection.apiKey,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      idToken: connection.idToken,
      expiresAt: connection.expiresAt,
      expiresIn: connection.expiresIn,
      lastRefreshAt: connection.lastRefreshAt,
      projectId: connection.projectId,
      connectionName: connection.displayName || connection.name || connection.email || connection.id,
      copilotToken: connection.providerSpecificData?.copilotToken,
      defaultModel: typeof connection.defaultModel === "string" ? connection.defaultModel.trim() || null : null,
      providerSpecificData: {
        ...(connection.providerSpecificData || {}),
        connectionProxyEnabled: proxyOptions.connectionProxyEnabled,
        connectionProxyUrl: proxyOptions.connectionProxyUrl,
        connectionNoProxy: proxyOptions.connectionNoProxy,
        connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
        vercelRelayUrl: proxyOptions.vercelRelayUrl,
        strictProxy: proxyOptions.strictProxy,
        resolutionKind: proxyOptions.resolutionKind,
      },
      connectionId: connection.id,
      // Include current status for optimization check
      testStatus: connection.testStatus,
      lastError: connection.lastError,
      // The admission slot this selection reserved. The caller HOLDS it for the
      // whole request and hands it back through releaseAccountLease() on every
      // exit — success, error, abort, client disconnect. Release is idempotent,
      // so a belt-and-braces release costs nothing and a missed one is a leaked
      // slot that never comes back until the process restarts.
      accountLease: lease,
      // Pass full connection for clearAccountError to read modelLock_* keys
      _connection: connection
    };
  } finally {
    releaseQueue();
    if (providerSelectionQueues.get(providerId) === nextQueue) {
      providerSelectionQueues.delete(providerId);
    }
  }
}

/**
 * Mark account+model as unavailable — locks modelLock_${model} in DB.
 * All errors (429, 401, 5xx, etc.) lock per model, not per account.
 * @param {string} connectionId
 * @param {number} status - HTTP status code from upstream
 * @param {string} errorText
 * @param {string|null} provider
 * @param {string|null} model - The specific model that triggered the error
 * @returns {{ shouldFallback: boolean, cooldownMs: number }}
 */
/**
 * Human-readable reason for the connection's `lastError`.
 *
 * A non-string error used to collapse to the bare string "Provider error", which
 * is what an operator then sees in the dashboard and in the console line below —
 * no status, no code, nothing to act on. A failed `fetch` is exactly that case:
 * Node reports `TypeError: fetch failed` and puts the useful part
 * (ECONNREFUSED, ENOTFOUND, ETIMEDOUT) on `error.cause.code`.
 *
 * Only message-shaped fields and error codes are read. The error object is never
 * serialized wholesale, so a request body or header that happens to be attached
 * to it cannot leak into the stored reason.
 */
export function describeProviderError(errorText) {
  // Clipped far enough out that the upstream reason survives. At 100 chars the cut
  // landed mid-word inside "Upstream request failed: …", so the only diagnostic
  // that mattered was discarded before it reached either the client or the logs.
  const clamp = (value) => String(value).replace(/\s+/g, " ").trim().slice(0, ACCOUNT_ERROR_MESSAGE_MAX_CHARS);

  if (typeof errorText === "string") return clamp(errorText);
  if (!errorText || typeof errorText !== "object") return "Provider error";

  const code = typeof errorText.code === "string" ? errorText.code
    : typeof errorText.cause?.code === "string" ? errorText.cause.code
      : null;

  if (errorText instanceof Error) {
    const message = errorText.message ? clamp(errorText.message) : errorText.name || "Provider error";
    return code && !message.includes(code) ? clamp(`${message} (${code})`) : message;
  }

  const candidates = [
    errorText.error?.message,
    errorText.message,
    typeof errorText.error === "string" ? errorText.error : null,
    errorText.detail,
    errorText.reason,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return code && !candidate.includes(code) ? clamp(`${candidate} (${code})`) : clamp(candidate);
    }
  }

  return code ? clamp(`Provider error (${code})`) : "Provider error";
}

export async function markAccountUnavailable(connectionId, status, errorText, provider = null, model = null, resetsAtMs = null, failureMetadata = null) {
  if (!connectionId || connectionId === "noauth") return { shouldFallback: false, cooldownMs: 0 };
  const connections = await getProviderConnections({ provider });
  const conn = connections.find(c => c.id === connectionId);
  const backoffLevel = conn?.backoffLevel || 0;

  if (isCodexPermanentOAuthFailure(status, errorText, provider)) {
    const reason = describeProviderError(errorText);
    await updateProviderConnection(connectionId, {
      isActive: false,
      testStatus: "reauth_required",
      lastError: reason,
      errorCode: 401,
      lastErrorAt: new Date().toISOString(),
      backoffLevel: 0,
    });
    const connName = conn?.displayName || conn?.name || conn?.email || connectionId.slice(0, 8);
    log.warn("AUTH", `${connName} requires Codex reauthorization [401]`);
    return { shouldFallback: true, cooldownMs: 0 };
  }

  // Qoder code 112 is an account-wide quota signal. A timed lock alone would
  // keep retrying a dead account after the cooldown, so deactivate the
  // connection (what an operator would do manually) and let selection move to
  // the next Qoder account or the next combo fallback model.
  if (isQoderQuotaExhausted(status, errorText, provider)) {
    const reason = typeof errorText === "string" ? errorText.slice(0, 200) : "Qoder quota exhausted (code 112)";
    await updateProviderConnection(connectionId, {
      isActive: false,
      testStatus: "unavailable",
      lastError: reason,
      errorCode: 403,
      lastErrorAt: new Date().toISOString(),
      backoffLevel: 0,
    });
    const connName = conn?.displayName || conn?.name || conn?.email || connectionId.slice(0, 8);
    log.warn("AUTH", `${connName} disabled: Qoder quota exhausted [403/code 112]`);
    return { shouldFallback: true, cooldownMs: 0 };
  }

  // GitHub premium-request exhaustion is account-wide until the next UTC month.
  const githubResetAtMs = githubMonthlyResetMs(status, errorText, provider);

  // A request error belongs to the caller, so reset metadata must not turn it
  // into a persisted account lock or a replay on another account.
  const fallbackResult = checkFallbackError(status, errorText, backoffLevel);
  if (!fallbackResult.shouldFallback) return fallbackResult;

  // Provider-specific precise cooldown (e.g. codex usage_limit_reached resets_at) overrides backoff.
  // GitHub's monthly exhaustion is a real month-long window and stays uncapped;
  // everything else is bounded by this provider's ceiling (#2895).
  let shouldFallback, cooldownMs, newBackoffLevel;
  if (githubResetAtMs) {
    shouldFallback = true;
    cooldownMs = githubResetAtMs - Date.now();
    newBackoffLevel = 0;
  } else if (resetsAtMs && resetsAtMs > Date.now()) {
    shouldFallback = true;
    cooldownMs = Math.min(resetsAtMs - Date.now(), retryDelayCapMs(provider));
    newBackoffLevel = 0;
  } else {
    ({ shouldFallback, cooldownMs, newBackoffLevel } = fallbackResult);
    // Only the backoff schedule, which is what a rate limit earns. A 401/403/404
    // lock is about the credential rather than a window, and shortening it would
    // just retry a dead key every minute.
    if (newBackoffLevel) cooldownMs = Math.min(cooldownMs, retryDelayCapMs(provider));
  }
  if (!shouldFallback) return { shouldFallback: false, cooldownMs: 0 };

  const reason = describeProviderError(errorText);
  const lockModel = githubResetAtMs ? null : model;
  const until = githubResetAtMs
    ? new Date(githubResetAtMs).toISOString()
    : new Date(Date.now() + cooldownMs).toISOString();
  const lockUpdate = buildModelLockUpdateAt(lockModel, until);
  const failureUpdate = buildModelFailureUpdate(lockModel, {
    status,
    message: reason,
    until,
    resetsAt: resetsAtMs ? new Date(resetsAtMs).toISOString() : null,
    clientErrorStatus: failureMetadata?.clientErrorStatus ?? null,
    unknownModelVerified: failureMetadata?.unknownModelVerified === true,
  });

  await updateProviderConnection(connectionId, {
    ...lockUpdate,
    ...failureUpdate,
    testStatus: "unavailable",
    lastError: reason,
    errorCode: status,
    lastErrorAt: new Date().toISOString(),
    backoffLevel: newBackoffLevel ?? backoffLevel
  });

  const lockKey = Object.keys(lockUpdate)[0];
  const connName = conn?.displayName || conn?.name || conn?.email || connectionId.slice(0, 8);
  log.warn("AUTH", `${connName} locked ${lockKey} for ${Math.round(cooldownMs / 1000)}s [${status}]`);

  if (provider && status && reason) {
    console.error(`❌ ${provider} [${status}]: ${reason}`);
  }

  return { shouldFallback: true, cooldownMs };
}

/**
 * Clear account error status on successful request.
 * - Clears modelLock_${model} (the model that just succeeded)
 * - Lazy-cleans any other expired modelLock_* keys
 * - Resets error state only if no active locks remain
 * @param {string} connectionId
 * @param {object} currentConnection - credentials object (has _connection) or raw connection
 * @param {string|null} model - model that succeeded
 */
export async function clearAccountError(connectionId, currentConnection, model = null) {
  if (!connectionId || connectionId === "noauth") return;
  const conn = currentConnection._connection || currentConnection;
  const now = Date.now();
  const allLockKeys = Object.keys(conn).filter(k => k.startsWith("modelLock_"));
  const allFailureKeys = Object.keys(conn).filter(k => k.startsWith("modelFailure_"));

  if (!conn.testStatus && !conn.lastError && allLockKeys.length === 0 && allFailureKeys.length === 0) return;

  // Keys to clear: current model's lock + all expired locks
  const keysToClear = allLockKeys.filter(k => {
    if (model && k === getModelLockKey(model)) return true; // succeeded model
    if (model && k === getModelLockKey(null)) return true;  // account-level lock
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() <= now;   // expired
  });

  const failureKeysToClear = new Set(keysToClear.map((key) =>
    getModelFailureKey(key.slice("modelLock_".length) || null)
  ));
  if (model && Object.hasOwn(conn, getModelFailureKey(model))) {
    failureKeysToClear.add(getModelFailureKey(model));
  }
  if (model && Object.hasOwn(conn, getModelFailureKey(null))) {
    failureKeysToClear.add(getModelFailureKey(null));
  }

  if (keysToClear.length === 0 && failureKeysToClear.size === 0 && conn.testStatus !== "unavailable" && !conn.lastError) return;

  // Check if any active locks remain after clearing
  const remainingActiveLocks = allLockKeys.filter(k => {
    if (keysToClear.includes(k)) return false;
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() > now;
  });

  const clearObj = Object.fromEntries(keysToClear.map(k => [k, null]));
  for (const key of failureKeysToClear) clearObj[key] = null;

  // Only reset error state if no active locks remain
  if (remainingActiveLocks.length === 0) {
    Object.assign(clearObj, {
      testStatus: "active",
      lastError: null,
      errorCode: null,
      lastErrorAt: null,
      backoffLevel: 0
    });
  }

  await updateProviderConnection(connectionId, clearObj);
}

/**
 * Extract API key from request headers
 */
export function extractApiKey(request) {
  return collectClientApiKeyCandidates(request)[0] || null;
}

/**
 * Validate API key (optional - for local use can skip)
 */
export async function isValidApiKey(apiKey) {
  if (!apiKey) return false;
  return await validateApiKey(apiKey);
}
