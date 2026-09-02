import { getUsageStats, statsEmitter, getActiveRequests } from "@/lib/usageDb";
import { scopeRecentToPeriod } from "@/lib/usagePeriod.js";

export const dynamic = "force-dynamic";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);

/**
 * Run `fn` at most once at a time, with one trailing run for whatever arrived
 * while it was busy.
 *
 * statsEmitter fires as often as every 150ms while the gateway serves traffic
 * (scheduleStatsEvent in usageRepo.js), and each "update" ran a full
 * getUsageStats here: the whole usageDaily rollup, two usageHistory scans and a
 * re-read of every provider connection and API key. Unguarded, those
 * recalculations stacked whenever one outlasted the interval that scheduled the
 * next, so a busy gateway with the dashboard open grew an unbounded set of
 * in-flight recalcs on the same event loop that serves /v1 — the busy-loop shape
 * in #3061 and the polling load in #3029. The emitter's other consumer already
 * refuses to re-enter (onStatsUpdate in lib/notifications/watcher.js); this is
 * the same guard, with a trailing run so the newest update is never the dropped
 * one.
 */
function coalesce(fn) {
  let running = false;
  let queued = false;
  return async function run() {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      await fn();
    } finally {
      running = false;
      if (queued) {
        queued = false;
        run().catch(() => {});
      }
    }
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const requestedPeriod = searchParams.get("period") || "today";
  const period = VALID_PERIODS.has(requestedPeriod) ? requestedPeriod : "today";
  // No date range here, deliberately (#3442). This stream exists to push live
  // changes, and a historical range does not change; the polled /api/usage/stats
  // and /api/usage/chart serve a selected range instead.
  const encoder = new TextEncoder();
  const state = {
    closed: false,
    keepalive: null,
    send: null,
    sendPending: null,
    cachedStats: null,
  };

  // Idempotent: safe to call from request.signal abort, cancel(), or enqueue failure.
  const cleanup = () => {
    if (state.closed) return;
    state.closed = true;
    if (state.send) statsEmitter.off("update", state.send);
    if (state.sendPending) statsEmitter.off("pending", state.sendPending);
    if (state.keepalive) clearInterval(state.keepalive);
  };

  // request.signal fires reliably on client disconnect; ReadableStream.cancel()
  // is not always invoked in Next.js, which caused listeners to accumulate on the
  // process-wide statsEmitter. Same pattern as translator/console-logs/stream.
  request?.signal?.addEventListener("abort", cleanup, { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      // Full stats refresh (heavy) + immediate lightweight push
      state.send = coalesce(async () => {
        if (state.closed) return;
        try {
          // Push lightweight update immediately so UI reflects changes fast
          if (state.cachedStats) {
            const { activeRequests, recentRequests, errorProvider } =
              await getActiveRequests();
            const quickStats = {
              ...state.cachedStats,
              activeRequests,
              // getActiveRequests reads a process-wide ring with no period in
              // it, so merging it raw put rows from outside the selection beside
              // totals that correctly excluded them — visibly stale data with no
              // page refresh, which is what #3198 reports.
              recentRequests: scopeRecentToPeriod(recentRequests, period),
              errorProvider,
            };
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(quickStats)}\n\n`),
            );
          }
          // Then do full recalc and update cache
          const stats = await getUsageStats(period);
          state.cachedStats = stats;
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(stats)}\n\n`),
          );
        } catch {
          cleanup();
        }
      });

      // Lightweight push: only refresh activeRequests + recentRequests on pending changes
      state.sendPending = coalesce(async () => {
        if (state.closed || !state.cachedStats) return;
        try {
          const { activeRequests, recentRequests, errorProvider } =
            await getActiveRequests();
          const stats = {
            ...state.cachedStats,
            activeRequests,
            recentRequests: scopeRecentToPeriod(recentRequests, period),
            errorProvider,
          };
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(stats)}\n\n`),
          );
        } catch {
          cleanup();
        }
      });

      await state.send();

      // The first send is awaited, so the client can be gone — or that send can have
      // failed and run cleanup — before we get here. Subscribing anyway would register
      // handlers nothing ever removes.
      if (state.closed) return;

      statsEmitter.on("update", state.send);
      statsEmitter.on("pending", state.sendPending);

      state.keepalive = setInterval(() => {
        if (state.closed) {
          clearInterval(state.keepalive);
          return;
        }
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          cleanup();
        }
      }, 25000);
    },

    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
