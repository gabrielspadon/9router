import { getRefreshLeadMs } from "open-sse/services/tokenRefresh.js";

/**
 * What the Usage dashboard needs to show token rotation as it happens (#3570).
 *
 * Every input is already persisted per connection — `expiresAt` and
 * `lastRefreshAt` are written by the refresh path itself — so this derives a
 * view rather than adding bookkeeping. It is pure: the caller supplies the
 * connections and the clock, which is what makes it testable without a DB.
 *
 * The "due" threshold is NOT invented here. getRefreshLeadMs is the same
 * function the router consults to decide whether a token needs refreshing, so a
 * connection this reports as due is one the next request would actually rotate.
 */

// Mirrors the parse in open-sse/services/tokenRefresh.js: an expiry is stored
// as an ISO string, or as an epoch in seconds or milliseconds depending on what
// the provider returned. A bare seconds value is below 1e12; anything above is
// already milliseconds.
function parseStampMs(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? (value < 1e12 ? value * 1000 : value) : null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

// A connection has rotation state worth reporting when it holds a token that
// expires, or has been refreshed at least once. An API-key connection has
// neither and is left out rather than listed as permanently "unknown".
export function rotates(connection) {
  return connection?.authType === "oauth"
    || connection?.expiresAt != null
    || connection?.tokenExpiresAt != null
    || connection?.lastRefreshAt != null;
}

export function describeRotation(connection, nowMs = Date.now()) {
  const expiresAtMs = parseStampMs(connection.expiresAt ?? connection.tokenExpiresAt);
  const lastRefreshMs = parseStampMs(connection.lastRefreshAt);
  const leadMs = getRefreshLeadMs(connection.provider, connection.providerSpecificData);

  let status = "unknown";
  if (expiresAtMs !== null) {
    if (expiresAtMs <= nowMs) status = "expired";
    else if (expiresAtMs - nowMs <= leadMs) status = "due";
    else status = "fresh";
  }

  return {
    id: connection.id,
    provider: connection.provider,
    // name/email are what the rest of the dashboard labels a connection with.
    // Nothing else about the connection is copied: it carries access and
    // refresh tokens, and this is a page anyone with the dashboard can read.
    name: connection.name || connection.email || null,
    authType: connection.authType || null,
    isActive: connection.isActive !== false,
    status,
    expiresAt: expiresAtMs === null ? null : new Date(expiresAtMs).toISOString(),
    lastRefreshAt: lastRefreshMs === null ? null : new Date(lastRefreshMs).toISOString(),
    // Negative once the token is already past its expiry, which is the honest
    // reading — clamping it to zero would hide how long it has been dead.
    expiresInMs: expiresAtMs === null ? null : expiresAtMs - nowMs,
    sinceRefreshMs: lastRefreshMs === null ? null : nowMs - lastRefreshMs,
    refreshLeadMs: leadMs,
  };
}

export function summarizeTokenRotation(connections, nowMs = Date.now()) {
  const rows = (Array.isArray(connections) ? connections : [])
    .filter(rotates)
    .map((c) => describeRotation(c, nowMs))
    .sort((a, b) => {
      // Soonest expiry first, and anything with no expiry at all last: the row
      // a reader needs to act on is the one about to rotate or already dead.
      if (a.expiresInMs === null) return b.expiresInMs === null ? 0 : 1;
      if (b.expiresInMs === null) return -1;
      return a.expiresInMs - b.expiresInMs;
    });

  const counts = { tracked: rows.length, fresh: 0, due: 0, expired: 0, unknown: 0 };
  for (const r of rows) counts[r.status] += 1;

  const next = rows.find((r) => r.expiresInMs !== null && r.expiresInMs > 0);
  return {
    generatedAt: new Date(nowMs).toISOString(),
    counts,
    nextExpiryAt: next?.expiresAt ?? null,
    nextExpiryInMs: next?.expiresInMs ?? null,
    connections: rows,
  };
}
