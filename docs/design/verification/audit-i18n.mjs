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
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
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
const ROUTES = [
  ["dashboard-home", "/dashboard"],
  ["providers", "/dashboard/providers"],
  ["statistics", "/dashboard/statistics"],
  ["combos", "/dashboard/combos"],
];

function measure() {
  const se = document.scrollingElement || document.documentElement;
  const overflow = Math.max(0, se.scrollWidth - se.clientWidth);
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
const storageState = await auth.storageState();
await auth.close();

const results = {};
for (const [loc, why] of LOCALES) {
  const ctx = await b.newContext({
    baseURL: BASE, storageState, viewport: { width: 1280, height: 800 },
    colorScheme: "dark", reducedMotion: "reduce", locale: loc,
  });
  await ctx.addCookies([{ name: "locale", value: loc, url: BASE }]);
  for (const [id, path] of ROUTES) {
    const p = await ctx.newPage();
    try {
      await p.goto(path, { waitUntil: "domcontentloaded", timeout: 30000 });
      await p.waitForTimeout(1800);
      const m = await p.evaluate(measure);
      results[`${loc}|${id}`] = { ...m, why };
      console.log(`${loc.padEnd(6)} ${id.padEnd(16)} overflow=${m.overflow} truncated=${m.truncated} nowrap=${m.nowrapped} dir=${m.dir}`);
      if (id === "providers" || loc === "fa")
        await p.screenshot({ path: `${OUT}/${loc}--${id}.png` });
    } catch (e) {
      results[`${loc}|${id}`] = { error: String(e).slice(0, 120), why };
      console.log(`${loc} ${id}: FAILED`);
    }
    await p.close();
  }
  await ctx.close();
}
await b.close();
writeFileSync(`${OUT}/i18n-audit.json`, JSON.stringify(results, null, 2));
console.log(`\nwrote ${OUT}/i18n-audit.json`);
