import { NextResponse } from "next/server";
import { getTokenSaverStats } from "@/lib/tokenSaver/events.js";
import { getPxpipeStats } from "@/lib/pxpipe/events.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawSince = searchParams.get("sinceMs");
    const rawTimeline = searchParams.get("timelineDays");
    const rawRecent = searchParams.get("recentLimit");

    const sinceMs = rawSince !== null && Number.isFinite(Number(rawSince)) ? Number(rawSince) : undefined;
    const timelineDays = Number.isFinite(Number(rawTimeline))
      ? Math.min(Math.max(Math.round(Number(rawTimeline)), 1), 90)
      : undefined;
    const recentLimit = Number.isFinite(Number(rawRecent))
      ? Math.min(Math.max(Math.round(Number(rawRecent)), 0), 500)
      : undefined;

    const tokenSaver = getTokenSaverStats({ sinceMs, timelineDays, recentLimit });
    let pxpipe = { windows: {}, timeline: [], recent: [] };
    try {
      const raw = getPxpipeStats({ timelineDays: timelineDays ?? 30, recentLimit: recentLimit ?? 100 });
      // Strip within-window cross-field percentages: this endpoint exposes
      // per-unit fields only, never savedPct.
      const windows = {};
      for (const [name, win] of Object.entries(raw.windows || {})) {
        const { savedPct, ...rest } = win || {};
        windows[name] = rest;
      }
      pxpipe = { windows, timeline: raw.timeline || [], recent: raw.recent || [] };
    } catch {
      pxpipe = { windows: {}, timeline: [], recent: [] };
    }

    const sources = {
      rtk: {
        state: "ok",
        unit: "chars",
        label: "chars reduced",
        source: "RTK events (chars)",
      },
      headroom: {
        state: tokenSaver.windows.all.headroomRequests > 0 ? "ok" : "idle",
        unit: "proxy-reported tokens + effective body bytes",
        label: "proxy-reported tokens",
        source: "aggregate events (no network)",
      },
      pxpipe: {
        state: pxpipe.windows.all ? "ok" : "unavailable",
        unit: "estimated tokens",
        label: "estimated tokens",
        source: "PXPIPE events (estimated tokens)",
        // caller owns pxpipe detail when present
      },
    };

    return NextResponse.json({
      windows: tokenSaver.windows,
      timeline: tokenSaver.timeline,
      recent: tokenSaver.recent,
      pxpipe,
      sources,
    });
  } catch (e) {
    // A read that failed measured nothing, and an all-zero body reads on the
    // page as "the token saver saved nothing" while making the client's
    // unavailable branch unreachable. Fail loudly with no figures in the reply;
    // the reason stays server-side because it names local paths.
    console.error("[token-saver/stats] read failed:", e);
    return NextResponse.json(
      { error: "token saver statistics unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
