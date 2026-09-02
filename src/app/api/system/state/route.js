import { NextResponse } from "next/server";
import { getTrafficWindow } from "@/lib/db/repos/requestStatsRepo.js";
import { getSpendWindow } from "@/lib/db/repos/usageRepo.js";
import { getUpstreamHealthSummary } from "@/lib/db/repos/connectionsRepo.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/system/state?windowSeconds=<60..21600>
 *
 * One aggregate telemetry read for the dashboard shell, closing
 * docs/design/backend-handoff.md:38-41. This is the DATA SOURCE only: it holds
 * no interval, no cache and no subscription, so refresh policy stays with the
 * caller.
 *
 * AUTH. Nothing here authenticates. `/api/system/state` is deliberately absent
 * from PUBLIC_API_PATHS and PUBLIC_PREFIXES in src/dashboardGuard.js, so it
 * falls to the deny-by-default branch for `/api/*` and an unauthenticated
 * request is refused 401 before the handler runs.
 *
 * THE NULL CONTRACT. Every measure is an envelope
 *   { value, unit, window, sampleCount, source, index, unavailable }
 * where `value: null` paired with a non-null `unavailable` string means the
 * backend could not answer. A zero is only ever a measurement: 0 requests in a
 * known window really is 0 req/s, but 0 errors out of 0 requests is not a rate
 * and 0 measured latencies is not a p95 — both of those are null.
 *
 * WHAT THIS SCHEMA CANNOT ANSWER TODAY.
 *  - failoverCount is permanently null. Combo and account fallback in
 *    open-sse/services/accountFallback.js mutate an in-memory account object
 *    (applyErrorState) and persist only the resulting connection state; no
 *    failover EVENT is written to any table, so there is nothing to count.
 *    Inferring one from consecutive error rows would be a fabricated number.
 *  - latencyP95 is null whenever no row in the window carries a measured
 *    latency. requestStats.latencyTotal is 0 both for "instant" and for "never
 *    measured" (rows backfilled from usageHistory carry 0), so zeros are
 *    excluded from the percentile rather than counted as fast responses.
 *  - providerHealth is a bounded, passive diagnostic. It names only Provider
 *    types, connection counts and safe state classes, never a connection ID,
 *    account label, credential or upstream error body. Quota headroom remains
 *    absent because no authoritative quota table exists.
 *
 * BOUNDED AND INDEXED. The window is clamped to [60s, 21600s]; the ceiling is
 * calibrated to the 200ms budget by measurement (see MAX_WINDOW_SECONDS).
 * Query plans, verified with EXPLAIN QUERY PLAN against src/lib/db/schema.js:
 *   requestStats counters + p95 → idx_rs_ts     (SEARCH ... timestamp>?)
 *   requestStats freshness      → idx_rs_ts     (COVERING INDEX)
 *   usageHistory spend          → idx_uh_ts     (SEARCH ... timestamp>?)
 *   providerConnections         → full SCAN, tens of rows. Every row is
 *                                 decrypted because auto-disabled auth failures
 *                                 remain operational recovery state; the flags
 *                                 live in encrypted `data`
 *
 * ABORT. Sources are read sequentially — they are local SQLite, so concurrency
 * buys nothing — and the abort signal is tested at every source boundary. An
 * abort answers 499 and no further query is issued.
 *
 * PARTIAL FAILURE. Each source is read in isolation; one throwing nulls only
 * its own measures and the response stays 200. There is no 500 path.
 */

const DEFAULT_WINDOW_SECONDS = 3600;
const MIN_WINDOW_SECONDS = 60;
// Calibrated, not guessed. Measured on a 250k-row requestStats + 250k-row
// usageHistory database spanning 24h (better-sqlite3, n=20 per window, whole
// handler cost): 900s→58ms, 3600s→74ms, 10800s→109ms, 21600s→156ms,
// 43200s→366ms, 86400s→511ms at p95. 6h is the widest window that stays inside
// the 200ms budget, because the traffic query reads status and latencyTotal off
// the heap (idx_rs_ts covers timestamp only) and so scales with rows in the
// window. A busier install crosses sooner; re-measure before raising this. A
// covering index on requestStats(timestamp, status, latencyTotal) would lift
// the ceiling, and lives in src/lib/db/schema.js.
const MAX_WINDOW_SECONDS = 21600;
const LATENCY_PERCENTILE = 0.95;

export const SYSTEM_STATE_UNITS = {
  throughput: "requests_per_second",
  errorRate: "ratio",
  latencyP95: "milliseconds",
  failoverCount: "count",
  spend: "usd",
  connectedUpstreams: "count",
  degradedUpstreams: "count",
};

// Measures this schema can never answer, whatever the data. Exported so a
// caller can hide the tile rather than render a permanent blank.
export const UNANSWERABLE = ["failoverCount"];

const NO_FAILOVER_SOURCE =
  "no failover events are persisted: open-sse/services/accountFallback.js keeps " +
  "fallback state in memory and writes only the resulting connection state, so " +
  "there is no event table to count";

function clampWindowSeconds(raw) {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_WINDOW_SECONDS;
  return Math.min(MAX_WINDOW_SECONDS, Math.max(MIN_WINDOW_SECONDS, parsed));
}

function measure(unit, window, fields = {}) {
  return {
    value: null,
    unit,
    window,
    sampleCount: null,
    source: null,
    index: null,
    unavailable: null,
    ...fields,
  };
}

// A source that threw tells the caller which measures it took down and why,
// rather than presenting its absence as a zero.
function unavailableFrom(error) {
  // Repository errors can contain a database path, URL, or credential-adjacent
  // upstream detail. This endpoint is polled by the dashboard, so its contract
  // exposes only the safe state class.
  return "source unavailable";
}

function freshnessOf(lastEventAt, generatedAtMs, windowSeconds) {
  if (lastEventAt === undefined) {
    return { state: "unknown", lastEventAt: null, ageSeconds: null, unit: "seconds" };
  }
  if (!lastEventAt) {
    return { state: "empty", lastEventAt: null, ageSeconds: null, unit: "seconds" };
  }
  const at = Date.parse(lastEventAt);
  if (Number.isNaN(at)) {
    return { state: "unknown", lastEventAt: null, ageSeconds: null, unit: "seconds" };
  }
  const ageSeconds = Math.max(0, (generatedAtMs - at) / 1000);
  return {
    state: ageSeconds <= windowSeconds ? "live" : "idle",
    lastEventAt,
    ageSeconds,
    unit: "seconds",
  };
}

function aborted(request) {
  return request?.signal?.aborted === true;
}

function clientClosed() {
  // 499 (nginx's "client closed request"): the work was abandoned, not failed.
  return NextResponse.json({ error: "Client closed request" }, { status: 499 });
}

export async function GET(request) {
  if (aborted(request)) return clientClosed();

  const windowSeconds = clampWindowSeconds(
    new URL(request.url).searchParams.get("windowSeconds")
  );
  const generatedAtMs = Date.now();
  const generatedAt = new Date(generatedAtMs).toISOString();
  const from = new Date(generatedAtMs - windowSeconds * 1000).toISOString();
  const rolling = { kind: "rolling", seconds: windowSeconds, from, to: generatedAt };
  const instant = { kind: "instant", seconds: 0, at: generatedAt };

  let traffic = null;
  let trafficError = null;
  try {
    traffic = await getTrafficWindow(from, { percentile: LATENCY_PERCENTILE });
  } catch (error) {
    trafficError = error;
    console.error("[system/state] requestStats unavailable");
  }
  if (aborted(request)) return clientClosed();

  let spend = null;
  let spendError = null;
  try {
    spend = await getSpendWindow(from);
  } catch (error) {
    spendError = error;
    console.error("[system/state] usageHistory unavailable");
  }
  if (aborted(request)) return clientClosed();

  let upstreams = null;
  let upstreamsError = null;
  try {
    upstreams = await getUpstreamHealthSummary(generatedAtMs);
  } catch (error) {
    upstreamsError = error;
    console.error("[system/state] providerConnections unavailable");
  }

  const measures = {
    throughput: measure(SYSTEM_STATE_UNITS.throughput, rolling, {
      source: "requestStats",
      index: "idx_rs_ts",
      ...(traffic
        ? { value: traffic.requests / windowSeconds, sampleCount: traffic.requests }
        : { unavailable: unavailableFrom(trafficError) }),
    }),

    // 0 errors out of 0 requests is not a rate — it is an unanswered question.
    errorRate: measure(SYSTEM_STATE_UNITS.errorRate, rolling, {
      source: "requestStats",
      index: "idx_rs_ts",
      ...(!traffic
        ? { unavailable: unavailableFrom(trafficError) }
        : traffic.requests > 0
          ? { value: traffic.errors / traffic.requests, sampleCount: traffic.requests }
          : {
              sampleCount: 0,
              unavailable: "no request was recorded in this window, so there is no rate to report",
            }),
    }),

    latencyP95: measure(SYSTEM_STATE_UNITS.latencyP95, rolling, {
      source: "requestStats",
      index: "idx_rs_ts",
      ...(!traffic
        ? { unavailable: unavailableFrom(trafficError) }
        : traffic.latencyPercentileMs !== null && traffic.latencyPercentileMs !== undefined
          ? { value: traffic.latencyPercentileMs, sampleCount: traffic.latencySamples }
          : {
              sampleCount: traffic.latencySamples,
              unavailable:
                "no request in this window carries a measured latency " +
                "(requestStats.latencyTotal is 0 for unmeasured and backfilled rows)",
            }),
    }),

    failoverCount: measure(SYSTEM_STATE_UNITS.failoverCount, rolling, {
      unavailable: NO_FAILOVER_SOURCE,
    }),

    spend: measure(SYSTEM_STATE_UNITS.spend, rolling, {
      source: "usageHistory",
      index: "idx_uh_ts",
      ...(spend
        ? { value: spend.spendUsd, sampleCount: spend.samples }
        : { unavailable: unavailableFrom(spendError) }),
    }),

    connectedUpstreams: measure(SYSTEM_STATE_UNITS.connectedUpstreams, instant, {
      source: "providerConnections",
      ...(upstreams
        ? { value: upstreams.connected, sampleCount: upstreams.total }
        : { unavailable: unavailableFrom(upstreamsError) }),
    }),

    // Persisted failures across configured connections. This can include an
    // auto-disabled auth failure that is no longer counted as connected.
    degradedUpstreams: measure(SYSTEM_STATE_UNITS.degradedUpstreams, instant, {
      source: "providerConnections",
      ...(upstreams
        ? { value: upstreams.degraded, sampleCount: upstreams.total }
        : { unavailable: unavailableFrom(upstreamsError) }),
    }),
  };

  // One scan feeds both count readouts and the actionable masthead. A second
  // health request would duplicate decryption work every refresh and could
  // disagree with the count the operator is looking at.
  const providerHealth = upstreams
    ? {
        status: upstreams.degraded > 0 ? "degraded" : "ok",
        source: "providerConnections",
        observedAt: generatedAt,
        unavailable: null,
        degradedProviderCount: upstreams.degradedProviderCount,
        degradedProvidersOmitted: upstreams.degradedProvidersOmitted,
        degradedProviders: upstreams.degradedProviders,
      }
    : {
        status: "unavailable",
        source: "providerConnections",
        observedAt: generatedAt,
        unavailable: unavailableFrom(upstreamsError),
        degradedProviderCount: null,
        degradedProvidersOmitted: null,
        degradedProviders: [],
      };

  return NextResponse.json(
    {
      generatedAt,
      window: rolling,
      freshness: freshnessOf(
        traffic ? traffic.lastEventAt : undefined,
        generatedAtMs,
        windowSeconds
      ),
      measures,
      providerHealth,
      unanswerable: Object.keys(measures).filter((name) => measures[name].value === null),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
