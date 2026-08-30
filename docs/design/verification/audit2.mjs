#!/usr/bin/env node
// Round-2 browser audit. Extends round 1 with the things the brief names and
// round 1 did not measure: a laptop viewport, phone coverage on every route
// rather than a subset, reflow at 200 percent zoom, status cues that survive
// colour blindness, and full keyboard traversal.
//
//   NODE_PATH=... node .unlazy/r2/audit2.mjs before http://127.0.0.1:20135
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const mode = process.argv[2];
const BASE = process.argv[3] || "http://127.0.0.1:20135";
const PASSWORD = process.env.SMOKE_PASSWORD || "123456";
const ONLY = process.env.ONLY_ROUTE || "";
if (!["before", "after"].includes(mode)) {
  console.error("usage: audit2.mjs <before|after> [baseUrl]"); process.exit(2);
}
const OUT = `.unlazy/r2/evidence/${mode}`;
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  ["login", "/login"], ["landing", "/landing"], ["dashboard-home", "/dashboard"],
  ["providers", "/dashboard/providers"], ["providers-new", "/dashboard/providers/new"],
  ["statistics", "/dashboard/statistics"], ["usage", "/dashboard/usage"],
  ["quota", "/dashboard/quota"], ["endpoint", "/dashboard/endpoint"],
  ["combos", "/dashboard/combos"], ["cli-tools", "/dashboard/cli-tools"],
  ["claude-compat", "/dashboard/claude-compat"], ["basic-chat", "/dashboard/basic-chat"],
  ["console-log", "/dashboard/console-log"], ["media-providers", "/dashboard/media-providers/web"],
  ["memory", "/dashboard/memory"], ["mitm", "/dashboard/mitm"],
  ["model-context", "/dashboard/model-context"], ["profile", "/dashboard/profile"],
  ["proxy-pools", "/dashboard/proxy-pools"], ["pxpipe", "/dashboard/pxpipe"],
  ["skills", "/dashboard/skills"], ["token-saver", "/dashboard/token-saver"],
  ["translator", "/dashboard/translator"],
].filter(([n]) => !ONLY || n === ONLY);

// Wide desktop, laptop, phone. Zoom is the same laptop layout at 200 percent,
// which a browser shows as half the CSS pixels.
const VIEWS = [
  ["desktop", { width: 1440, height: 900 }],
  ["laptop", { width: 1280, height: 800 }],
  ["phone", { width: 390, height: 844 }],
];
const ZOOM200 = { width: 640, height: 800 };

// ---------- in-page audits ----------
function auditContrast() {
  const lum = (r, g, b) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const parse = (s) => { const m = (s || "").match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(",").map((x) => parseFloat(x.trim())); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const bgOf = (el) => { let n = el; while (n && n !== document.documentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0.85) return c; n = n.parentElement; } const c = parse(getComputedStyle(document.body).backgroundColor); return c && c.a > 0 ? c : { r: 255, g: 255, b: 255, a: 1 }; };
  const out = [], seen = new Set();
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const text = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join("").trim();
    if (!text) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) < 0.5) continue;
    if (el.classList.contains("material-symbols-outlined")) continue;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    const fg = parse(cs.color); if (!fg || fg.a < 0.5) continue;
    const bg = bgOf(el);
    const ratio = (Math.max(lum(fg.r, fg.g, fg.b), lum(bg.r, bg.g, bg.b)) + 0.05) / (Math.min(lum(fg.r, fg.g, fg.b), lum(bg.r, bg.g, bg.b)) + 0.05);
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5;
    if (ratio + 0.005 < need) {
      const bgs = `rgb(${bg.r}, ${bg.g}, ${bg.b})`, key = cs.color + "|" + bgs + "|" + Math.round(size);
      if (seen.has(key)) continue; seen.add(key);
      out.push({ ratio: Math.round(ratio * 100) / 100, need, fg: cs.color, bg: bgs, fontSize: cs.fontSize, sample: text.slice(0, 40) });
    }
  }
  return out;
}

function auditNames() {
  const sel = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"]';
  const visible = (el) => { const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none") return false; if (el.hasAttribute("disabled")) return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  const visibleText = (el) => { const c = el.cloneNode(true); for (const i of Array.from(c.querySelectorAll(".material-symbols-outlined, svg, img"))) i.remove(); return (c.textContent || "").replace(/\s+/g, " ").trim(); };
  const label = (el) => {
    const aria = (el.getAttribute("aria-label") || el.getAttribute("title") || "").trim(); if (aria) return aria;
    const lb = el.getAttribute("aria-labelledby"); if (lb && document.getElementById(lb.split(/\s+/)[0])) return "labelledby";
    if (["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) {
      const ph = (el.getAttribute("placeholder") || "").trim(); if (ph) return ph;
      const id = el.getAttribute("id"); if (id && document.querySelector(`label[for="${id}"]`)) return "labelled";
      if (el.closest("label")) return "wrapped-label";
    }
    return visibleText(el);
  };
  const els = Array.from(document.querySelectorAll(sel)).filter(visible);
  const unnamed = [];
  for (const el of els) { if (label(el)) continue; if (!el.querySelector(".material-symbols-outlined, svg, img")) continue; unnamed.push({ tag: el.tagName.toLowerCase(), cls: String(el.getAttribute("class") || "").slice(0, 90) }); }
  return { total: els.length, unnamed: unnamed.slice(0, 30) };
}

function auditFocusRing(limit) {
  const sel = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const visible = (el) => { const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none") return false; if (el.hasAttribute("disabled")) return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  const sig = (el) => { const cs = getComputedStyle(el); return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.borderColor].join("|"); };
  const indicated = (el) => { const cs = getComputedStyle(el); return (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== "none"); };
  const els = Array.from(document.querySelectorAll(sel)).filter(visible).slice(0, limit);
  const bad = [];
  for (const el of els) { const b = sig(el); el.focus({ preventScroll: true }); const changed = sig(el) !== b; const paints = indicated(el); el.blur(); if (!changed || !paints) bad.push({ tag: el.tagName.toLowerCase(), reason: !changed ? "no-change-on-focus" : "no-indicator-painted", cls: String(el.getAttribute("class") || "").slice(0, 90) }); }
  return { checked: els.length, bad: bad.slice(0, 20) };
}

// Horizontal overflow is the reflow failure: at 200 percent a user must not
// have to scroll sideways to read.
function auditReflow() {
  const se = document.scrollingElement || document.documentElement;
  const overflow = se.scrollWidth - se.clientWidth;
  const wide = [];
  if (overflow > 2) {
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const r = el.getBoundingClientRect();
      if (r.width > se.clientWidth + 2 && r.height > 4) {
        wide.push({ tag: el.tagName.toLowerCase(), w: Math.round(r.width), cls: String(el.getAttribute("class") || "").slice(0, 80) });
        if (wide.length >= 8) break;
      }
    }
  }
  return { overflow: Math.max(0, overflow), viewport: se.clientWidth, offenders: wide };
}

// Status must not be carried by hue alone. A small element painted a semantic
// colour with no text, no icon and no accessible name fails for a colour-blind
// user regardless of contrast ratio.
function auditHueOnly() {
  const parse = (s) => { const m = (s || "").match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(",").map((x) => parseFloat(x.trim())); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const saturated = (c) => { if (!c || c.a < 0.4) return false; const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b); return mx - mn > 40; };
  const out = [];
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.width > 64 || r.height > 64) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    if (!saturated(parse(cs.backgroundColor))) continue;
    if (el.children.length) continue;
    const txt = (el.textContent || "").trim();
    const named = el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("role");
    if (txt || named) continue;
    out.push({ tag: el.tagName.toLowerCase(), bg: cs.backgroundColor, w: Math.round(r.width), h: Math.round(r.height), cls: String(el.getAttribute("class") || "").slice(0, 80) });
    if (out.length >= 15) break;
  }
  return out;
}

// ---------- driver ----------
const results = { mode, base: BASE, routes: {} };
const browser = await chromium.launch();
const authCtx = await browser.newContext({ baseURL: BASE });
const loginRes = await authCtx.request.post("/api/auth/login", { data: { password: PASSWORD }, headers: { "Content-Type": "application/json" } });
if (!loginRes.ok()) { console.error(`login failed: ${loginRes.status()}`); await browser.close(); process.exit(1); }
const storageState = await authCtx.storageState();
await authCtx.close();

async function visit(name, path, theme, viewport, tag, { shot = true, zoom = false } = {}) {
  const ctx = await browser.newContext({ baseURL: BASE, storageState, viewport, colorScheme: theme, reducedMotion: "reduce" });
  await ctx.addInitScript((t) => { try { window.localStorage.setItem("theme", JSON.stringify({ state: { theme: t }, version: 0 })); } catch { /* blocked */ } }, theme);
  const page = await ctx.newPage();
  const consoleErrors = [], failedRequests = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e.message).slice(0, 300)));
  page.on("requestfailed", (r) => { const why = r.failure()?.errorText || ""; if (why.includes("ERR_ABORTED")) return; failedRequests.push(`${r.method()} ${r.url().slice(0, 160)} ${why}`); });
  page.on("response", (r) => { if (r.status() >= 500) failedRequests.push(`${r.status()} ${r.url().slice(0, 160)}`); });

  let navError = null;
  try { await page.goto(path, { waitUntil: "domcontentloaded", timeout: 45000 }); await page.waitForTimeout(2000); }
  catch (e) { navError = String(e.message).split("\n")[0]; }

  if (shot) { try { await page.screenshot({ path: `${OUT}/${name}--${theme}--${tag}.png`, fullPage: false }); } catch { /* gone */ } }

  const r = { path, navError, consoleErrors, failedRequests };
  if (!navError) {
    if (zoom) { try { r.reflow = await page.evaluate(auditReflow); } catch { /* ignore */ } }
    else {
      try { r.contrast = (await page.evaluate(auditContrast)) || []; } catch { r.contrast = []; }
      try { r.names = (await page.evaluate(auditNames)) || { total: 0, unnamed: [] }; } catch { r.names = { total: 0, unnamed: [] }; }
      try { r.focus = (await page.evaluate(auditFocusRing, 25)) || { checked: 0, bad: [] }; } catch { r.focus = { checked: 0, bad: [] }; }
      try { r.hueOnly = (await page.evaluate(auditHueOnly)) || []; } catch { r.hueOnly = []; }
      // Keyboard traversal: tab through and record what receives focus, and
      // whether focus ever escapes into nothing (a trap or a dead end).
      if (tag === "desktop" && theme === "dark") {
        const seq = [];
        try {
          await page.keyboard.press("Tab");
          for (let i = 0; i < 40; i++) {
            const cur = await page.evaluate(() => {
              const a = document.activeElement; if (!a || a === document.body) return null;
              const c = a.cloneNode(true); c.querySelectorAll?.(".material-symbols-outlined,svg,img").forEach((n) => n.remove());
              return { tag: a.tagName.toLowerCase(), name: (a.getAttribute("aria-label") || (c.textContent || "").replace(/\s+/g, " ").trim() || a.getAttribute("placeholder") || "").slice(0, 50) };
            });
            if (!cur) { seq.push({ tag: "(escaped to body)", name: "" }); break; }
            seq.push(cur);
            await page.keyboard.press("Tab");
          }
        } catch { /* ignore */ }
        r.tabOrder = { steps: seq.length, unnamed: seq.filter((s) => s && !s.name).length, sequence: seq.slice(0, 40) };
      }
    }
  }
  results.routes[`${name}|${theme}|${tag}`] = r;
  const n = (x) => (x || []).length;
  console.log(`${name}|${theme}|${tag}  err=${n(r.consoleErrors)} net=${n(r.failedRequests)} contrast=${n(r.contrast)} unnamed=${n(r.names?.unnamed)} nofocus=${n(r.focus?.bad)} hue=${n(r.hueOnly)}${r.reflow ? ` overflow=${r.reflow.overflow}` : ""}${navError ? " NAV_ERROR" : ""}`);
  await ctx.close();
}

for (const [name, path] of ROUTES) {
  for (const theme of ["light", "dark"]) for (const [tag, vp] of VIEWS) await visit(name, path, theme, vp, tag);
  await visit(name, path, "dark", ZOOM200, "zoom200", { shot: true, zoom: true });
}
await browser.close();
writeFileSync(`.unlazy/r2/evidence/${mode}.json`, JSON.stringify(results, null, 2));
const tot = (f) => Object.values(results.routes).reduce((a, r) => a + f(r), 0);
console.log(`\n${mode}: views=${Object.keys(results.routes).length} consoleErrors=${tot((r) => (r.consoleErrors || []).length)} failedRequests=${tot((r) => (r.failedRequests || []).length)} contrastFailures=${tot((r) => (r.contrast || []).length)} unnamedIconControls=${tot((r) => (r.names?.unnamed || []).length)} focusRingFailures=${tot((r) => (r.focus?.bad || []).length)} hueOnly=${tot((r) => (r.hueOnly || []).length)} reflowOverflow=${tot((r) => (r.reflow?.overflow ? 1 : 0))}`);
