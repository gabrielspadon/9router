// Provider connection status — the single answer to "does this account work
// right now?". Pure, so it is testable without a DOM and shared by both card
// variants on the route.
//
// WHY THIS IS NOT A BOOLEAN. `markAccountUnavailable` (src/sse/services/auth.js)
// writes `testStatus:"unavailable"` together with a `modelLock_<model>` key
// holding the moment the cooldown lifts. The lock is what actually stops
// routing; `testStatus` is only cleared later, by `clearAccountError`, and only
// once a request through that connection SUCCEEDS. An idle connection therefore
// keeps `testStatus:"unavailable"` indefinitely after its cooldown has lapsed.
//
// The code this replaces compensated for that staleness by rewriting
// `unavailable` to `active` whenever no future lock existed. The compensation
// was right — an expired cooldown really does mean the connection is routable
// again — but it threw away every other fact in the row, so a credential
// thirteen days past expiry and a connection whose last word from upstream was
// a 404 both rendered as a green "Connected".
//
// That intent is preserved here as the `recovering` state: routable again, and
// said so, without claiming a success nobody has observed. The states that
// genuinely need the operator (`expired`, `failing`) are no longer folded into
// it, and a live cooldown keeps its own state and its reset time.

import { getErrorCode } from "@/shared/utils";

/** Short tag for the upstream condition: "429", "AUTH", "5XX", "RUNTIME"… */
export function getConnectionErrorTag(connection) {
  if (!connection) return null;

  const explicitType = connection.lastErrorType;
  if (explicitType === "runtime_error") return "RUNTIME";
  if (
    explicitType === "upstream_auth_error" ||
    explicitType === "auth_missing" ||
    explicitType === "token_refresh_failed" ||
    explicitType === "token_expired"
  )
    return "AUTH";
  if (explicitType === "upstream_rate_limited") return "429";
  if (explicitType === "upstream_unavailable") return "5XX";
  if (explicitType === "network_error") return "NET";

  const numericCode = Number(connection.errorCode);
  if (Number.isFinite(numericCode) && numericCode >= 400)
    return String(numericCode);

  const fromMessage = getErrorCode(connection.lastError);
  if (fromMessage === "401" || fromMessage === "403") return "AUTH";
  if (fromMessage && fromMessage !== "ERR") return fromMessage;

  const msg = (connection.lastError || "").toLowerCase();
  if (
    msg.includes("runtime") ||
    msg.includes("not runnable") ||
    msg.includes("not installed")
  )
    return "RUNTIME";
  if (
    msg.includes("invalid api key") ||
    msg.includes("token invalid") ||
    msg.includes("revoked") ||
    msg.includes("unauthorized")
  )
    return "AUTH";

  return "ERR";
}

/** Epoch ms for a value stored as ISO string, seconds, or milliseconds. */
function toEpochMs(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

/** "in 45s" / "in 15m" / "in 2h" / "in 3d" — how long until a cooldown lifts. */
export function formatDuration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  // Minutes run to two hours before the unit changes. Switching at 60 made a
  // 90-minute cooldown round to "2h", which overstates the wait an operator is
  // being told to sit through.
  if (minutes < 120) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * Earliest still-running model lock, or null when every lock has lapsed.
 *
 * `open-sse/services/accountFallback.js` has the same scan, but it reads
 * `Date.now()` internally, which makes the state it produces untestable. The
 * clock is a parameter here for that reason.
 */
function getEarliestLockUntil(conn, now) {
  let earliest = null;
  for (const [key, value] of Object.entries(conn)) {
    if (!key.startsWith("modelLock_") || !value) continue;
    const until = toEpochMs(value);
    if (until === null || until <= now) continue;
    if (earliest === null || until < earliest) earliest = until;
  }
  return earliest;
}

const isRateLimit = (conn) =>
  Number(conn?.errorCode) === 429 || conn?.lastErrorType === "upstream_rate_limited";

/**
 * One connection's real condition. Every branch returns a word an operator can
 * read and, where the operator has something to do, the thing to do.
 *
 * @param {object} conn - a row from `GET /api/providers`
 * @param {number} [now] - epoch ms, injected so the states are testable
 * @returns {{state:string, tone:string, label:string, detail:string|null, action:string|null}}
 */
export function classifyConnection(conn, now = Date.now()) {
  if (!conn) {
    return { state: "unknown", tone: "idle", label: "Unknown", detail: null, action: null };
  }

  // The operator turned this off. Not a fault, and not a claim that it works.
  if (conn.isActive === false) {
    return {
      state: "disabled",
      tone: "idle",
      label: "Disabled",
      detail: null,
      action: "Switch it on to route traffic here",
    };
  }

  // A live model lock is the only thing that blocks routing right now, and it
  // carries the moment it lifts. Reported ahead of everything else because it
  // is the condition the operator is actually inside.
  const lockUntil = getEarliestLockUntil(conn, now);
  if (lockUntil !== null) {
    const retry = `Retries automatically in ${formatDuration(lockUntil - now)}`;
    return isRateLimit(conn)
      ? { state: "rate_limited", tone: "degraded", label: "Rate limited", detail: getConnectionErrorTag(conn), action: retry }
      : { state: "cooling_down", tone: "degraded", label: "Cooling down", detail: getConnectionErrorTag(conn), action: retry };
  }

  // Access token past its expiry. A connection that refreshes normally is never
  // seen here: background refresh runs every five minutes with a thirty-minute
  // lead (src/sse/services/backgroundTokenRefresh.js). Sitting past expiry means
  // refresh is not happening — either it is failing or it is switched off via
  // DISABLE_BACKGROUND_TOKEN_REFRESH. Neither is something to render as green.
  // `refreshToken` is stripped from the API response, so the dashboard cannot
  // tell those apart; naming the fact it can see is the fail-safe reading.
  const expiresAt = toEpochMs(conn.expiresAt ?? conn.tokenExpiresAt);
  if (expiresAt !== null && expiresAt <= now) {
    return {
      state: "expired",
      tone: "failing",
      label: "Token expired",
      detail: getConnectionErrorTag(conn),
      action: "Reconnect this account",
    };
  }

  if (conn.testStatus === "error") {
    return {
      state: "failing",
      tone: "failing",
      label: "Error",
      detail: getConnectionErrorTag(conn),
      action: "Open the connection and re-test it",
    };
  }

  // Cooldown lapsed, but nothing has succeeded since the failure. This is the
  // exact case the old rewrite existed for, and its judgement is kept: routing
  // will pick this connection up again, so it is not red. What is dropped is the
  // claim that it works — no success has been observed since the failure, and
  // amber is what "will be retried, not yet proven" looks like.
  if (conn.testStatus === "unavailable") {
    return {
      state: "recovering",
      tone: "degraded",
      label: "Last call failed",
      detail: getConnectionErrorTag(conn),
      action: "Retried automatically; re-test to confirm it recovered",
    };
  }

  if (conn.testStatus === "active" || conn.testStatus === "success") {
    return { state: "connected", tone: "ok", label: "Connected", detail: null, action: null };
  }

  return {
    state: "unknown",
    tone: "idle",
    label: "Not tested",
    detail: null,
    action: "Run a test to find out",
  };
}

// Worst first: what needs the operator leads the card, "Connected" trails it.
const STATE_ORDER = [
  "expired",
  "failing",
  "rate_limited",
  "cooling_down",
  "recovering",
  "unknown",
  "disabled",
  "connected",
];

/**
 * Aggregate one provider's connections for a card. `states` holds one entry per
 * distinct condition present, and its counts sum to `total` — the card can
 * never show a number the rows do not support.
 *
 * @param {Array<object>} conns
 * @param {number} [now] - epoch ms, injected so the states are testable
 */
export function summarizeProviderConnections(conns = [], now = Date.now()) {
  const results = conns.map((conn) => ({ conn, ...classifyConnection(conn, now) }));

  const states = STATE_ORDER.map((state) => {
    const hits = results.filter((r) => r.state === state);
    if (!hits.length) return null;
    // Detail and next action come from the most recent failure in the group, so
    // a card summarising several broken accounts names the freshest one.
    const newest = hits.reduce((a, b) =>
      toEpochMs(b.conn?.lastErrorAt) > toEpochMs(a.conn?.lastErrorAt) ? b : a,
    );
    return {
      state,
      tone: newest.tone,
      label: newest.label,
      detail: newest.detail,
      action: newest.action,
      count: hits.length,
    };
  }).filter(Boolean);

  const latestError = results
    .filter((r) => r.state !== "connected" && r.conn?.lastErrorAt)
    .sort((a, b) => toEpochMs(b.conn.lastErrorAt) - toEpochMs(a.conn.lastErrorAt))[0];

  return {
    total: conns.length,
    connected: results.filter((r) => r.state === "connected").length,
    states,
    latestErrorAt: latestError?.conn.lastErrorAt || null,
    allDisabled: conns.length > 0 && conns.every((c) => c.isActive === false),
  };
}
