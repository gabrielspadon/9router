/**
 * Project ID Service - Fetch and cache real Project IDs from Google Cloud Code API
 *
 *
 * Instead of generating random project IDs (e.g. "useful-spark-a1b2c"),
 * this service fetches the real Project ID bound to the authenticated user's account.
 * This significantly reduces the risk of being flagged by Google's anti-abuse systems.
 */

import { CLOUD_CODE_API, LOAD_CODE_ASSIST_HEADERS, ANTIGRAVITY_LOAD_CODE_ASSIST_HEADERS, LOAD_CODE_ASSIST_METADATA } from "../config/appConstants.js";
import { ANTIGRAVITY_SAFE_ERROR_MESSAGE, classifyAntigravityValidation, redactAntigravityValidationText } from "./antigravityValidation.js";

// ─── Cache ────────────────────────────────────────────────────────────────────
// connectionId -> { projectId: string, fetchedAt: number }
const projectIdCache = new Map();

/** How long a cached project ID is considered fresh (1 hour). */
const CACHE_TTL_MS = 60 * 60 * 1000;

// ─── Pending-fetch deduplication ─────────────────────────────────────────────
// connectionId -> typed pending project operation
const pendingFetches = new Map();

/** Abort and evict a pending fetch that has been running longer than this (2 min). */
const PENDING_TTL_MS = 2 * 60 * 1000;

// ─── Periodic cleanup ────────────────────────────────────────────────────────
/** How often the background sweep runs (10 min). */
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

let _cleanupTimer = null;

/** Run one sweep immediately: evict stale cache entries and abort orphaned pending fetches. */
export function cleanupNow() {
    const now = Date.now();

    for (const [id, entry] of projectIdCache) {
        if (!entry || now - entry.fetchedAt >= CACHE_TTL_MS) {
            projectIdCache.delete(id);
        }
    }

    for (const [id, item] of pendingFetches) {
        if (!item || typeof item.startedAt !== "number") {
            pendingFetches.delete(id);
            continue;
        }
        if (now - item.startedAt > PENDING_TTL_MS) {
            item.released = true;
            try { item.controller.abort(); } catch (_) { /* ignore */ }
            pendingFetches.delete(id);
        }
    }
}

/** Start the periodic background cleanup (idempotent). Called automatically on module load. */
export function startCacheCleanup() {
    if (_cleanupTimer) return;
    _cleanupTimer = setInterval(() => {
        try { cleanupNow(); } catch (e) {
            console.warn("[ProjectId] cleanup sweep error:", e?.message ?? e);
        }
    }, CLEANUP_INTERVAL_MS);
    // Unref so the timer doesn't prevent Node from exiting when it is otherwise idle
    _cleanupTimer?.unref?.();
}

/** Stop the periodic background cleanup (e.g. during graceful shutdown). */
export function stopCacheCleanup() {
    if (!_cleanupTimer) return;
    clearInterval(_cleanupTimer);
    _cleanupTimer = null;
}

// Start automatically when the module is first imported
startCacheCleanup();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get the Project ID for a connection, with caching.
 * Returns null on failure (callers should fall back to random generation).
 *
 * @param {string} connectionId - The connection identifier for cache keying
 * @param {string} accessToken  - Valid OAuth access token
 * @param {object} [hooks] - Trusted verification callback context
 * @returns {Promise<string|null>} Real project ID or null
 */
export async function getProjectIdForConnection(connectionId, accessToken, provider = "gemini-cli", hooks = {}) {
    if (!connectionId || !accessToken) return null;

    // Return cached value if still fresh
    const cached = projectIdCache.get(connectionId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return cached.projectId;
    }

    // Deduplicate concurrent fetches for the same connection
    let pendingEntry = pendingFetches.get(connectionId);
    if (!pendingEntry) {
        const controller = new AbortController();
        pendingEntry = {
            controller,
            startedAt: Date.now(),
            observationId: hooks?.verificationContext?.observationId ?? crypto.randomUUID(),
            challengeIdAtStart: hooks?.verificationContext?.challengeIdAtStart ?? null,
            released: false,
            promise: null,
        };
        pendingFetches.set(connectionId, pendingEntry);
        pendingEntry.promise = fetchProjectOutcome(accessToken, controller.signal, provider)
            .then((outcome) => {
                if (outcome.kind === "project" && pendingFetches.get(connectionId) === pendingEntry && !pendingEntry.released) {
                    projectIdCache.set(connectionId, {projectId: outcome.projectId, fetchedAt: Date.now()});
                }
                return outcome;
            })
            .catch((error) => {
                const message = provider === "antigravity"
                    ? ANTIGRAVITY_SAFE_ERROR_MESSAGE
                    : redactAntigravityValidationText(error?.message || String(error));
                console.warn("[ProjectId] project lookup failed", connectionId.slice(0, 8), message.slice(0, 200));
                return { kind: "failure" };
            })
            .finally(() => {
                if (pendingFetches.get(connectionId) === pendingEntry) pendingFetches.delete(connectionId);
            });
    }

    const outcome = await pendingEntry.promise;
    await notifyVerificationOutcome(outcome, pendingEntry, hooks, connectionId);
    return outcome.kind === "project" ? outcome.projectId : null;
}

/**
 * Fully remove a connection: abort any in-flight fetch and delete its cached project ID.
 * Wire this into your connection close / disconnect lifecycle events to prevent memory leaks.
 *
 * @param {string} connectionId
 */
export function removeConnection(connectionId) {
    if (!connectionId) return;
    projectIdCache.delete(connectionId);
    const pending = pendingFetches.get(connectionId);
    if (pending) {
        pending.released = true;
        try { pending.controller.abort(); } catch (_) { /* ignore */ }
        pendingFetches.delete(connectionId);
    }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Fetch project ID via loadCodeAssist endpoint.
 * Falls back to onboardUser when loadCodeAssist returns no project.
 *
 * @param {string}      accessToken
 * @param {AbortSignal} signal
 * @returns {Promise<{kind: "project", projectId: string}|{kind: "validation_required", validation: object}|{kind: "failure"}>}
 */
async function fetchProjectOutcome(accessToken, signal, provider) {
    const endpoints = CLOUD_CODE_API[provider] || CLOUD_CODE_API["gemini-cli"];
    const headers = provider === "antigravity" ? ANTIGRAVITY_LOAD_CODE_ASSIST_HEADERS : LOAD_CODE_ASSIST_HEADERS;
    const response = await fetch(endpoints.loadCodeAssist, {
        method: "POST",
        headers: { ...headers, "Authorization": `Bearer ${accessToken}` },
        body: JSON.stringify({ metadata: LOAD_CODE_ASSIST_METADATA }),
        signal
    });

    const { data, text } = await readResponseBody(response);
    const validation = classifyAntigravityValidation({ status: response.status, payload: data, source: "loadCodeAssist" });
    if (validation) return { kind: "validation_required", validation };
    if (!response.ok) {
        const message = provider === "antigravity"
            ? ANTIGRAVITY_SAFE_ERROR_MESSAGE
            : `loadCodeAssist failed: HTTP ${response.status} ${redactAntigravityValidationText(text).slice(0, 200)}`;
        throw new Error(message);
    }
    const projectId = extractProjectId(data);
    if (projectId) return { kind: "project", projectId };

    // Determine the tier to use for onboarding
    let tierID = "legacy-tier";
    if (Array.isArray(data?.allowedTiers)) {
        for (const tier of data.allowedTiers) {
            if (tier && typeof tier === "object" && tier.isDefault === true) {
                if (tier.id && typeof tier.id === "string" && tier.id.trim()) {
                    tierID = tier.id.trim();
                    break;
                }
            }
        }
    }

    return onboardUser(accessToken, tierID, signal, endpoints, provider);
}

/**
 * Fetch project ID via onboardUser endpoint (polls until done).
 *
 * @param {string}      accessToken
 * @param {string}      tierID
 * @param {AbortSignal} externalSignal  – propagated from the connection's AbortController
 * @returns {Promise<{kind: "project", projectId: string}|{kind: "validation_required", validation: object}|{kind: "failure"}>}
 */
async function onboardUser(accessToken, tierID, externalSignal, endpoints, provider) {
    console.log(`[ProjectId] Onboarding user with tier: ${tierID}`);

    const reqBody = { tierId: tierID, metadata: LOAD_CODE_ASSIST_METADATA };
    const headers = provider === "antigravity" ? ANTIGRAVITY_LOAD_CODE_ASSIST_HEADERS : LOAD_CODE_ASSIST_HEADERS;
    const MAX_ATTEMPTS = 5;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        // Bail out immediately if the connection was removed
        if (externalSignal?.aborted) return { kind: "failure" };

        // Per-attempt timeout controller; forwards external abort as well
        const localCtrl = new AbortController();
        const timeoutId = setTimeout(() => localCtrl.abort(), 30_000);
        const forwardAbort = () => localCtrl.abort();
        externalSignal?.addEventListener("abort", forwardAbort);

        try {
            const response = await fetch(endpoints.onboardUser, {
                method: "POST",
                headers: { ...headers, "Authorization": `Bearer ${accessToken}` },
                body: JSON.stringify(reqBody),
                signal: localCtrl.signal
            });

            clearTimeout(timeoutId);

            const { data, text } = await readResponseBody(response);
            const validation = classifyAntigravityValidation({ status: response.status, payload: data, source: "onboardUser" });
            if (validation) return { kind: "validation_required", validation };
            if (!response.ok) {
                const message = provider === "antigravity"
                    ? ANTIGRAVITY_SAFE_ERROR_MESSAGE
                    : `onboardUser HTTP ${response.status}: ${redactAntigravityValidationText(text).slice(0, 200)}`;
                throw new Error(message);
            }

            if (data?.done === true) {
                const projectId = extractProjectIdFromOnboard(data);
                if (projectId) {
                    console.log(`[ProjectId] Successfully onboarded, project ID: ${projectId}`);
                    return { kind: "project", projectId };
                }
                // done:true with no usable project id is terminal: Google returns an
                // empty cloudaicompanionProject object for accounts it won't provision.
                // Retrying cannot change the answer, so bail out immediately.
                console.warn(
                    provider === "antigravity"
                        ? `[ProjectId] ${ANTIGRAVITY_SAFE_ERROR_MESSAGE}`
                        : "[ProjectId] onboardUser finished without a project ID (account not provisioned)",
                );
                return { kind: "failure" };
            }

            // Server not done yet – wait and retry
            console.log(`[ProjectId] Onboard attempt ${attempt}/${MAX_ATTEMPTS}: not done yet, waiting...`);
            await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === "AbortError") {
                console.warn(
                    provider === "antigravity"
                        ? `[ProjectId] ${ANTIGRAVITY_SAFE_ERROR_MESSAGE}`
                        : `[ProjectId] onboardUser attempt ${attempt} aborted (timeout or connection removed)`,
                );
                if (externalSignal?.aborted) return { kind: "failure" };   // connection gone – stop retrying
                continue;
            }
            if (attempt === MAX_ATTEMPTS) {
                const message = provider === "antigravity"
                    ? ANTIGRAVITY_SAFE_ERROR_MESSAGE
                    : redactAntigravityValidationText(error?.message || "unknown error");
                console.warn(`[ProjectId] onboardUser failed after ${MAX_ATTEMPTS} attempts: ${message}`);
                return { kind: "failure" };
            }
            // Continue to next attempt instead of throwing (which would skip remaining retries)
            const message = provider === "antigravity"
                ? ANTIGRAVITY_SAFE_ERROR_MESSAGE
                : redactAntigravityValidationText(error?.message || "unknown error");
            console.warn(`[ProjectId] onboardUser attempt ${attempt} failed: ${message}, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
        } finally {
            clearTimeout(timeoutId);
            externalSignal?.removeEventListener("abort", forwardAbort);
        }
    }

    return { kind: "failure" };
}

async function readResponseBody(response) {
    // Production fetch Responses always expose text(). Keep the legacy unit-test
    // response doubles that predate the single-read contract compatible without
    // changing the production read path.
    if (typeof response?.text !== "function") {
        const data = typeof response?.json === "function" ? await response.json() : null;
        return { text: JSON.stringify(data), data };
    }
    const text = await response.text();
    try {
        return { text, data: JSON.parse(text) };
    } catch {
        return { text, data: null };
    }
}

async function notifyVerificationOutcome(outcome, pendingEntry, hooks, connectionId) {
    if (pendingEntry.released || !hooks || typeof hooks !== "object") return;
    try {
        if (outcome.kind === "validation_required" && typeof hooks.onValidationRequired === "function") {
            await hooks.onValidationRequired({ validation: outcome.validation, observationId: pendingEntry.observationId });
        } else if (outcome.kind === "project" && typeof hooks.onVerificationSuccess === "function") {
            await hooks.onVerificationSuccess({ challengeId: pendingEntry.challengeIdAtStart });
        }
    } catch {
        const callback = outcome.kind === "validation_required" ? "validation" : "success";
        console.warn("[ProjectId] verification callback failed", callback, connectionId.slice(0, 8));
    }
}

/**
 * Extract project ID from loadCodeAssist response.
 */
function extractProjectId(data) {
    if (!data) return null;

    if (typeof data.cloudaicompanionProject === "string") {
        const id = data.cloudaicompanionProject.trim();
        if (id) return id;
    }

    if (data.cloudaicompanionProject && typeof data.cloudaicompanionProject === "object") {
        const id = data.cloudaicompanionProject.id;
        if (typeof id === "string" && id.trim()) return id.trim();
    }

    return null;
}

/**
 * Extract project ID from onboardUser response.
 */
function extractProjectIdFromOnboard(data) {
    if (!data?.response) return null;

    const project = data.response.cloudaicompanionProject;

    if (typeof project === "string") {
        const id = project.trim();
        if (id) return id;
    }

    if (project && typeof project === "object") {
        const id = project.id;
        if (typeof id === "string" && id.trim()) return id.trim();
    }

    return null;
}
