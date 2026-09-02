// Turns state TokenProxy ALREADY persists into webhook events (#3141).
//
// NO NEW INSTRUMENTATION. Every signal read here is written by code that
// already runs; nothing was added to a request path to feed this:
//
//   provider.unhealthy / provider.recovered
//     ← providerConnections.testStatus / errorCode / rateLimitedUntil, written
//       by src/sse/services/auth.js (421-489) when an upstream rejects a
//       request and cleared at 556-558 when one succeeds. The predicate is
//       isConnectionDegraded() from connectionsRepo.js:363 — the same one the
//       dashboard's health counts use, so an alert and the UI can never
//       disagree.
//   high.error.rate
//     ← requestStats, via getTrafficWindow() (requestStatsRepo.js:397), the
//       exact source /api/system/state already reports errorRate from.
//
// THE TRIGGER IS ALSO NOT NEW. statsEmitter "update" (usageRepo.js:123) is
// already emitted, debounced, after every batch of request writes, so this
// module owns no timer: it evaluates when traffic happens and is idle
// otherwise. Evaluation is throttled to MIN_INTERVAL_MS so a busy gateway
// pays one connection scan per interval, not one per request.
//
// Everything here is fail-open: evaluate() swallows its own errors and emit()
// is fire-and-forget, so a broken webhook cannot reach a routed request.

import { getProviderConnections, isConnectionDegraded } from "@/lib/db/repos/connectionsRepo.js";
import { getTrafficWindow } from "@/lib/db/repos/requestStatsRepo.js";
import { statsEmitter } from "@/lib/db/repos/usageRepo.js";
import { emit, getNotificationsConfig } from "./webhooks.js";

const MIN_INTERVAL_MS = 30000;

// Survive Next.js hot reload — one watcher and one state snapshot per process.
const g = (global.__notificationWatcher ??= {
  subscribed: false,
  lastRunAt: 0,
  running: false,
  // connectionId -> was degraded at the previous evaluation. Absent means
  // "never seen": the first sighting seeds silently, so a restart with an
  // already-broken account does not replay it as a fresh incident.
  degraded: new Map(),
  errorRateFiring: false,
});

function describe(conn) {
  return {
    provider: conn.provider,
    connectionId: conn.id,
    account: conn.name || conn.email || null,
    testStatus: conn.testStatus ?? null,
    errorCode: conn.errorCode ?? null,
    rateLimitedUntil: conn.rateLimitedUntil ?? null,
  };
}

/**
 * One diff pass. Returns the events it produced (also useful as the API's
 * "evaluate now" response). Never throws.
 */
export async function evaluate(deps = {}) {
  const {
    listConnections = getProviderConnections,
    trafficWindow = getTrafficWindow,
    degradedPredicate = isConnectionDegraded,
    config: providedConfig,
    send = emit,
    state = g,
    now = Date.now(),
  } = deps;

  const events = [];
  try {
    const config = providedConfig ?? (await getNotificationsConfig());
    if (!config.enabled) return { skipped: "disabled", events };

    const connections = await listConnections({ isActive: true });
    const seen = new Set();
    for (const conn of connections) {
      seen.add(conn.id);
      const bad = degradedPredicate(conn, now);
      const previous = state.degraded.get(conn.id);
      state.degraded.set(conn.id, bad);
      if (previous === undefined || previous === bad) continue;
      events.push({ event: bad ? "provider.unhealthy" : "provider.recovered", data: describe(conn) });
    }
    // A deleted or disabled connection is not a recovery — drop it silently so
    // re-enabling it later seeds again instead of firing a phantom event.
    for (const id of [...state.degraded.keys()]) {
      if (!seen.has(id)) state.degraded.delete(id);
    }

    const { threshold, windowSeconds, minSamples } = config.errorRate;
    const since = new Date(now - windowSeconds * 1000).toISOString();
    const traffic = await trafficWindow(since);
    // Below minSamples there is no rate to report — 1 error out of 1 request is
    // not a 100% error rate, and firing on it is how alerting gets muted.
    if (traffic && traffic.requests >= minSamples) {
      const rate = traffic.errors / traffic.requests;
      const firing = rate >= threshold;
      if (firing && !state.errorRateFiring) {
        events.push({
          event: "high.error.rate",
          data: {
            rate,
            threshold,
            windowSeconds,
            requests: traffic.requests,
            errors: traffic.errors,
          },
        });
      }
      state.errorRateFiring = firing;
    }

    for (const { event, data } of events) send(event, data);
    return { skipped: null, events };
  } catch (err) {
    console.warn("[Webhooks] watcher evaluation failed:", err?.message || err);
    return { skipped: "error", error: err?.message || String(err), events };
  }
}

async function onStatsUpdate() {
  const now = Date.now();
  if (g.running || now - g.lastRunAt < MIN_INTERVAL_MS) return;
  g.running = true;
  g.lastRunAt = now;
  try {
    await evaluate();
  } finally {
    g.running = false;
  }
}

/**
 * Idempotent. Safe to call from any request handler; the subscription is
 * process-wide and installed at most once.
 *
 * NOT wired at boot: src/instrumentation.js is the process's only boot hook and
 * belongs to another lane. Until one line there imports this module, the
 * watcher arms on the first /api/notifications request instead, which means a
 * headless restart stays silent until something touches that route.
 */
export function ensureWatcher() {
  if (g.subscribed) return false;
  g.subscribed = true;
  statsEmitter.on("update", () => { onStatsUpdate().catch(() => {}); });
  return true;
}
