import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Per-stage savings: windows.<win>.stages.<saver> = { requests, applied,
// bytesSaved }. Same ingestion path and storage seam as token-saver-events.test.js.
let TMP;
let eventsMod;

beforeEach(() => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), "tokenproxy-tsstages-"));
});

afterEach(() => {
  if (eventsMod) eventsMod.__setTokenSaverEventsDirForTest(null);
  eventsMod = null;
  fs.rmSync(TMP, { recursive: true, force: true });
});

function dayMs(n) {
  return Date.now() - n * 24 * 60 * 60 * 1000;
}

async function loadMod() {
  return (eventsMod = await import("@/lib/tokenSaver/events.js"));
}

describe("tokenSaver per-stage savings", () => {
  it("sums signed bytesSaved per saver per window", async () => {
    const mod = await loadMod();
    mod.__setTokenSaverEventsDirForTest(TMP);
    // today: rtk twice (one without bytesSaved), headroom once
    mod.appendTokenSaverEvent({ ts: Date.now(), saver: "rtk", applied: true, charsSaved: 10, bytesSaved: -1000 });
    mod.appendTokenSaverEvent({ ts: Date.now(), saver: "rtk", applied: true, charsSaved: 5 });
    mod.appendTokenSaverEvent({ ts: Date.now(), saver: "headroom", applied: true, tokensSaved: 400, bytesSaved: -500 });
    // yesterday: pxpipe growth (positive bytesSaved is reported, not clamped)
    mod.appendTokenSaverEvent({ ts: dayMs(1), saver: "pxpipe", applied: true, tokensSavedEst: 10, bytesSaved: 200 });
    // 8 days ago: rtk, only in all + last30d
    mod.appendTokenSaverEvent({ ts: dayMs(8), saver: "rtk", applied: false, charsSaved: 3, bytesSaved: -80 });

    const s = mod.getTokenSaverStats();

    expect(s.windows.today.stages.rtk).toEqual({ requests: 2, applied: 2, bytesSaved: -1000 });
    expect(s.windows.today.stages.headroom).toEqual({ requests: 1, applied: 1, bytesSaved: -500 });
    expect(s.windows.today.stages.pxpipe).toEqual({ requests: 0, applied: 0, bytesSaved: 0 });
    expect(s.windows.yesterday.stages.pxpipe).toEqual({ requests: 1, applied: 1, bytesSaved: 200 });
    expect(s.windows.yesterday.stages.rtk.bytesSaved).toBe(0);
    expect(s.windows.last7d.stages.rtk.bytesSaved).toBe(-1000);
    expect(s.windows.last30d.stages.rtk).toEqual({ requests: 3, applied: 2, bytesSaved: -1080 });
    expect(s.windows.all.stages.rtk).toEqual({ requests: 3, applied: 2, bytesSaved: -1080 });
  });

  it("applies sinceMs filtering to stages exactly like the window totals", async () => {
    const mod = await loadMod();
    mod.__setTokenSaverEventsDirForTest(TMP);
    mod.appendTokenSaverEvent({ ts: dayMs(10), saver: "rtk", applied: true, charsSaved: 10, bytesSaved: -700 });
    mod.appendTokenSaverEvent({ ts: Date.now(), saver: "rtk", applied: true, charsSaved: 4, bytesSaved: -300 });

    const cutoff = dayMs(5);
    const s = mod.getTokenSaverStats({ sinceMs: cutoff });

    expect(s.windows.all.requests).toBe(1);
    expect(s.windows.all.stages.rtk).toEqual({ requests: 1, applied: 1, bytesSaved: -300 });
  });

  it("stages ride along through the /api/token-saver/stats route response", async () => {
    const mod = await loadMod();
    mod.__setTokenSaverEventsDirForTest(TMP);
    mod.appendTokenSaverEvent({ ts: Date.now(), saver: "headroom", applied: true, tokensSaved: 12, bytesSaved: -42 });

    const { GET } = await import("../../src/app/api/token-saver/stats/route.js");
    const res = await GET({ url: "http://localhost/api/token-saver/stats" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.windows.all.stages.headroom).toEqual({ requests: 1, applied: 1, bytesSaved: -42 });
    expect(body.windows.all.stages.rtk.bytesSaved).toBe(0);
  });
});
