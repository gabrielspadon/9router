#!/usr/bin/env node
// Localisation as a layout constraint. Drives the product in the length stress
// cases (German, Vietnamese), the density cases (Chinese, Japanese) and the
// right-to-left case (Persian), and measures what breaks rather than assuming.
//
// Reports, per locale and route: horizontal overflow, elements clipped by
// truncation, labels forced onto one line by whitespace-nowrap, and the
// document's resolved writing direction.
//
// Playwright is not a dependency of this repository. Point NODE_PATH at an
// installation that has it, for example:
//   NODE_PATH=$(npm root -g) node docs/design/verification/audit2.mjs after
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  buildEvidencePrivacyContext,
  maskEvidenceDom,
  redactEvidenceValue,
} from "./redactEvidence.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://127.0.0.1:20135";
const PASSWORD = process.env.SMOKE_PASSWORD || "123456";
const OUT = "docs/design/evidence/i18n";
mkdirSync(OUT, { recursive: true });

const LOCALES = [
  ["de", "German, length stress"],
  ["vi", "Vietnamese, length stress"],
  ["zh-CN", "Chinese, density"],
  ["ja", "Japanese, density"],
  ["fa", "Persian, right to left"],
];
// A locale breaks a layout where the layout has least room, so the phone is
// where a long German label or a right-to-left mirror actually fails. Measuring
// only 1280 wide reported the easy case.
const VIEWPORTS = [
  ["desktop", { width: 1280, height: 800 }],
  ["phone", { width: 390, height: 844 }],
];
const ROUTES = [
  ["dashboard-home", "/dashboard"],
  ["providers", "/dashboard/providers"],
  ["providers-new", "/dashboard/providers/new"],
  ["statistics", "/dashboard/statistics"],
  ["combos", "/dashboard/combos"],
];

function measure() {
  // Walks up rather than testing one element, because the overflow is owned by
  // whichever ancestor scrolls, not by the node that happens to be wide.
  const isInsideScroller = (el) => {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const ox = getComputedStyle(node).overflowX;
      if (ox === "auto" || ox === "scroll") return true;
    }
    return false;
  };
  const se = document.scrollingElement || document.documentElement;
  // The app shell clips horizontally, so the document's own
  // `scrollWidth - clientWidth` is structurally zero and reporting it as
  // "no overflow" was a tautology, not a measurement. What actually matters
  // is whether any element's content is wider than the viewport, which is
  // still true when an ancestor hides the evidence.
  const clipped = Math.max(0, se.scrollWidth - se.clientWidth);
  const viewport = se.clientWidth;
  let widest = 0;
  const overflowing = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    // A deliberate horizontal scroller owns its own overflow, and so does
    // everything inside it: a wide table is why the scroller exists. Skipping
    // only the scroller element itself still counted its own `<table>`, so a
    // design decision was reported five times as a locale break. The check is
    // "is this content wider than the viewport with nowhere to scroll", which
    // means asking about the ancestors too.
    if (isInsideScroller(el)) continue;
    const width = Math.max(el.scrollWidth, Math.ceil(el.getBoundingClientRect().width));
    if (width > viewport + 1) {
      widest = Math.max(widest, width - viewport);
      if (overflowing.length < 6) {
        overflowing.push(`${el.tagName.toLowerCase()} +${width - viewport}px`);
      }
    }
  }
  const overflow = widest;
  // A label clipped by truncation when the same text appears nowhere else is
  // information lost, so both are counted.
  let truncated = 0, nowrapped = 0;
  const samples = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const clipped = el.scrollWidth > el.clientWidth + 1 &&
      (cs.textOverflow === "ellipsis" || cs.overflow === "hidden");
    if (clipped && el.textContent.trim()) {
      truncated++;
      if (samples.length < 6) samples.push((el.textContent || "").trim().slice(0, 40));
    }
    if (cs.whiteSpace === "nowrap" && (el.textContent || "").trim().length > 24) nowrapped++;
  }
  return {
    overflow,
    clipped,
    viewport,
    overflowing,
    truncated,
    nowrapped,
    dir: document.documentElement.getAttribute("dir") || getComputedStyle(document.body).direction,
    lang: document.documentElement.getAttribute("lang"),
    samples,
  };
}

const b = await chromium.launch();
const auth = await b.newContext({ baseURL: BASE });
const r = await auth.request.post("/api/auth/login", { data: { password: PASSWORD }, headers: { "Content-Type": "application/json" } });
if (!r.ok()) { console.error(`login failed ${r.status()}`); process.exit(1); }
const [connectionsResponse, nodesResponse] = await Promise.all([
  auth.request.get("/api/providers"),
  auth.request.get("/api/provider-nodes"),
]);
if (!connectionsResponse.ok() || !nodesResponse.ok()) {
  console.error("privacy context unavailable; refusing to retain evidence");
  await b.close();
  process.exit(4);
}
const privacyContext = buildEvidencePrivacyContext({
  connections: (await connectionsResponse.json()).connections || [],
  nodes: (await nodesResponse.json()).nodes || [],
});
const storageState = await auth.storageState();
await auth.close();

// The same provenance triple the browser and inventory captures carry. An
// evidence file that cannot name its seed and build is not evidence of a build.
const provenanceFromFile = (file) => {
  try {
    const d = JSON.parse(readFileSync(file, "utf8"));
    return { sourceRevision: d.sourceDigest || null, buildId: d.buildId || null };
  } catch { return {}; }
};
const fileProvenance = process.env.I18N_PROVENANCE_FILE
  ? provenanceFromFile(process.env.I18N_PROVENANCE_FILE)
  : {};
const provenance = {
  seedDigest: process.env.I18N_SEED_DIGEST || null,
  sourceRevision: fileProvenance.sourceRevision || process.env.I18N_SOURCE_REVISION || null,
  buildId: fileProvenance.buildId || process.env.I18N_BUILD_ID || null,
  capturedAt: new Date().toISOString(),
  viewports: VIEWPORTS.map(([name, v]) => `${name} ${v.width}x${v.height}`),
};

const results = { provenance };
for (const [loc, why] of LOCALES) {
  for (const [surface, viewport] of VIEWPORTS) {
    const ctx = await b.newContext({
      baseURL: BASE, storageState, viewport,
      colorScheme: "dark", reducedMotion: "reduce", locale: loc,
    });
    await ctx.addCookies([{ name: "locale", value: loc, url: BASE }]);
    for (const [id, path] of ROUTES) {
      const key = surface === "desktop" ? `${loc}|${id}` : `${loc}|${id}|${surface}`;
      const p = await ctx.newPage();
      try {
        await p.goto(path, { waitUntil: "domcontentloaded", timeout: 30000 });
        await p.waitForTimeout(1800);
        const m = await p.evaluate(measure);
        results[key] = redactEvidenceValue({ ...m, surface, why }, privacyContext);
        console.log(`${loc.padEnd(6)} ${surface.padEnd(7)} ${id.padEnd(16)} overflow=${m.overflow} clipped=${m.clipped} truncated=${m.truncated} nowrap=${m.nowrapped} dir=${m.dir}`);
        if (surface === "desktop" && (id === "providers" || loc === "fa")) {
          const captureSession = await ctx.newCDPSession(p);
          await p.evaluate(maskEvidenceDom, privacyContext);
          await captureSession.send("Emulation.setScriptExecutionDisabled", { value: true });
          await p.screenshot({ path: `${OUT}/${loc}--${id}.png` });
        }
      } catch (e) {
        results[key] = { error: String(e).slice(0, 120), surface, why };
        console.log(`${loc} ${surface} ${id}: FAILED`);
      }
      await p.close();
    }
    await ctx.close();
  }
}
await b.close();
writeFileSync(`${OUT}/i18n-audit.json`, JSON.stringify(results, null, 2));
console.log(`\nwrote ${OUT}/i18n-audit.json`);
