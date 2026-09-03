/**
 * ABI projections: internal records to the wire shapes in
 * docs/reconciliation/admin-abi.json.
 *
 * EVERY FIELD IS PICKED BY NAME. No function here spreads an input into its
 * output, for the reason src/shared/utils/switchReceipt.js gives and for one
 * more specific to this layer: connectionsRepo.rowToConn spreads the DECRYPTED
 * credential blob into every connection object it returns, so a connection in
 * memory carries accessToken, refreshToken and apiKey beside its id. A
 * spread-then-redact projection would disclose the next secret field anyone
 * adds upstream. A pick cannot.
 */

import { isConnectionDegraded } from "@/lib/db/repos/connectionsRepo.js";

// The store and the ranker speak freshness (fresh/stale/unknown); the ABI
// speaks provenance (measured/estimated/unknown). They are not the same axis,
// but they map cleanly: evidence read fresh from a provider response IS the
// measured reading, and evidence carried forward past its observation is
// exactly what the ABI calls estimated. Anything else is unknown, which is the
// safe direction — rule 2 forbids unknown from outranking known evidence.
const CONFIDENCE = { fresh: "measured", measured: "measured", stale: "estimated", estimated: "estimated" };

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isoOrNull(value) {
  if (typeof value !== "string" || !value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// WindowRecord requires all six fields, so a row missing one is completed
// rather than dropped: an absent window reads to a ranker as an account with
// fewer constraints, which ranks it ABOVE accounts that reported honestly.
export function toWindowRecord(row) {
  return {
    scope: String(row?.scope ?? ""),
    remaining: num(row?.remaining),
    limit: num(row?.limit),
    resetAt: isoOrNull(row?.resetAt) ?? new Date(0).toISOString(),
    observedAt: isoOrNull(row?.observedAt) ?? new Date(0).toISOString(),
    confidence: CONFIDENCE[row?.confidence] ?? "unknown",
  };
}

export function toWindowRecords(rows) {
  return Array.isArray(rows) ? rows.map(toWindowRecord) : [];
}

/**
 * Operator-visible failure text for a connection.
 *
 * Truncated and stripped of anything that looks like a bearer credential.
 * lastError is written from upstream responses by testUtils and the SSE layer,
 * and an upstream is free to echo the Authorization header it rejected back in
 * its error body. Length alone would not save us; the pattern strip is what
 * does.
 */
const CREDENTIAL_SHAPED = /\b(?:sk|pk|api|key|token|bearer|secret)[-_a-z0-9]*[-_ :=]+[A-Za-z0-9._~+/-]{8,}/gi;

export function redactError(value) {
  if (typeof value !== "string" || !value) return null;
  return value.replace(CREDENTIAL_SHAPED, "[redacted]").slice(0, 300);
}

/**
 * Connection status, in the ABI's vocabulary.
 *
 * Order matters and encodes precedence: draining is an operator's explicit
 * decision and outranks every observed condition, and an inactive connection
 * is unqualified regardless of how healthy its last probe looked.
 */
export function connectionStatus(conn, { isDraining, now = Date.now() } = {}) {
  if (isDraining) return "drained";
  if (!conn?.isActive) return "unqualified";
  const until = conn.rateLimitedUntil ? Date.parse(conn.rateLimitedUntil) : NaN;
  if (Number.isFinite(until) && until > now) return "cooldown";
  if (isConnectionDegraded(conn, now)) return "degraded";
  // No probe has ever run, so nothing has established the connection works.
  if (!conn.testStatus) return "unqualified";
  return "healthy";
}

export function toConnection(conn, { isDraining = false, now = Date.now() } = {}) {
  return {
    connectionId: conn.id,
    provider: conn.provider,
    displayName: typeof conn.name === "string" && conn.name ? conn.name : null,
    status: connectionStatus(conn, { isDraining, now }),
    isActive: Boolean(conn.isActive),
    isDraining: Boolean(isDraining),
    lastQualifiedAt: isoOrNull(conn.lastTestedAt) ?? isoOrNull(conn.updatedAt),
    lastError: redactError(conn.lastError),
  };
}

export function toQuotaSnapshot(conn, windows) {
  return { connectionId: conn.id, provider: conn.provider, windows: toWindowRecords(windows) };
}

// accountSwitches rows carry the trigger vocabulary the scheduler writes
// (first-pin, repin, cohort-degraded); the ABI's enum is closed and different.
// An unmapped trigger becomes "manual" rather than passing through, because a
// value outside the enum is a contract violation and "manual" is the reading
// that claims the least.
const TRIGGER = {
  exhausted: "exhausted",
  reset: "reset",
  drain: "drain",
  model_failure: "model_failure",
  "model-failure": "model_failure",
  "cohort-degraded": "model_failure",
  manual: "manual",
  "first-pin": "manual",
  repin: "reset",
};

export function toSwitchReceipt(row) {
  return {
    receiptId: row.id,
    timestamp: isoOrNull(row.switchedAt) ?? new Date(0).toISOString(),
    trigger: TRIGGER[row.trigger] ?? "manual",
    model: String(row.model ?? ""),
    // Already a one-way hash where the scheduler wrote it. Never re-derived
    // here: this layer must not be the place a raw session id could enter.
    sessionHash: String(row.sessionHash ?? ""),
    oldConnectionId: row.fromConnectionId ?? null,
    newConnectionId: row.toConnectionId,
    windows: {
      old: Array.isArray(row.windows?.old) ? toWindowRecords(row.windows.old) : null,
      // The scheduler persists the destination account's windows as a bare
      // array; the ABI splits them into old and new. A bare array is the new
      // account's evidence, which is the account the receipt is about.
      new: Array.isArray(row.windows) ? toWindowRecords(row.windows) : toWindowRecords(row.windows?.new),
    },
  };
}
