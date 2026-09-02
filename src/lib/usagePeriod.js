// Period arithmetic for the usage views, shared by the repo that aggregates the
// numbers and by the SSE route that pushes them. Deliberately free of any DB
// import so a route can scope a payload without pulling the adapter chain in.

export const PERIOD_MS = { "24h": 86400000, "7d": 604800000, "30d": 2592000000, "60d": 5184000000 };

// The oldest timestamp a period includes, or null for "all". The daily branch
// of getUsageStats aggregates whole days, so the day-based periods share the
// same day boundary rather than a rolling multiple of 24h; otherwise the recent
// panel and the totals above it disagree at the edge of the range.
export function periodCutoffIso(period) {
  if (period === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  if (period === "24h") return new Date(Date.now() - PERIOD_MS["24h"]).toISOString();
  const days = { "7d": 7, "30d": 30, "60d": 60 }[period];
  if (!days) return null;
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate() - days + 1).toISOString();
}

// The recent-requests panel that `getActiveRequests` feeds reads a process-wide
// ring with no period in it, while `getUsageStatsInRange` scopes its own
// recentRequests to the selection. The usage SSE stream merges the two on every
// push, so without this the first request to complete after a period switch
// re-injects rows from outside the selected period beside totals that correctly
// exclude them (#3198). "all" scopes nothing, which is the existing behaviour.
export function scopeRecentToPeriod(rows, period = "all") {
  const cutoff = periodCutoffIso(period);
  if (!cutoff) return rows || [];
  const min = new Date(cutoff).getTime();
  return (rows || []).filter((r) => {
    const t = new Date(r?.timestamp).getTime();
    // A row with no usable timestamp cannot be shown to be inside the window,
    // and this feeds a panel that sits under a period label — so it stays out.
    return Number.isFinite(t) && t >= min;
  });
}
