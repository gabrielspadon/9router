#!/usr/bin/env node
// Browser audit. Every route, both themes, wide desktop, laptop and phone,
// plus reflow at 200 percent zoom, status cues that survive colour blindness,
// and full keyboard traversal.
//
//   node docs/design/verification/audit2.mjs before http://127.0.0.1:20135
//
// The measured JSON is committed under docs/design/evidence/raw so every gate
// re-runs from a clean checkout. The raw PNG capture is a build artefact:
// docs/design/verification/publish-shots.mjs converts it to the committed webp.
//
// Playwright is not a dependency of this repository. Point NODE_PATH at an
// installation that has it, for example:
//   NODE_PATH=$(npm root -g) node docs/design/verification/audit2.mjs after
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  buildEvidencePrivacyContext,
  maskEvidenceDom,
  redactEvidenceText,
  redactEvidenceValue,
} from "./redactEvidence.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const mode = process.argv[2];
const BASE = process.argv[3] || "http://127.0.0.1:20135";
const PASSWORD = process.env.SMOKE_PASSWORD || "123456";
const ONLY = process.env.ONLY_ROUTE || "";
const SKIP = process.env.SKIP_ROUTE || "";
// The build identity has to come from the instance itself, not from whatever
// the operator typed. `instance.sh` writes `.verification-provenance.json` next
// to the snapshot it started; pointing at that file makes the provenance a
// reading rather than an assertion. The env vars remain for a baseline whose
// instance predates the file.
const provenanceFromFile = (p) => {
  try {
    const d = JSON.parse(readFileSync(p, "utf8"));
    return { sourceRevision: d.sourceDigest || null, buildId: d.buildId || null };
  } catch { return {}; }
};
const fileProvenance = process.env.AUDIT_PROVENANCE_FILE
  ? provenanceFromFile(process.env.AUDIT_PROVENANCE_FILE)
  : {};
const provenance = {
  seedDigest: process.env.AUDIT_SEED_DIGEST || null,
  sourceRevision: fileProvenance.sourceRevision || process.env.AUDIT_SOURCE_REVISION || null,
  buildId: fileProvenance.buildId || process.env.AUDIT_BUILD_ID || null,
};
if (!["before", "after"].includes(mode)) {
  console.error("usage: audit2.mjs <before|after> [baseUrl]"); process.exit(2);
}
const OUT = `${process.env.SHOTS_DIR || "/tmp/tokenproxy-design-shots"}/${mode}`;
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  ["login", "/login"], ["landing", "/landing"], ["dashboard-home", "/dashboard"],
  ["providers", "/dashboard/providers"],
  ["providers-new", "/dashboard/providers/new"],
  ["provider-claude", "/dashboard/providers/claude"],
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
].filter(([n]) => (!ONLY || n === ONLY) && (!SKIP || n !== SKIP));

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
  const isInert = (el) => Boolean(el.closest("[inert], [aria-hidden='true']"));
  const lum = (r, g, b) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const parse = (s) => { const m = (s || "").match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(",").map((x) => parseFloat(x.trim())); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const bgOf = (el) => { let n = el; while (n && n !== document.documentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0.85) return c; n = n.parentElement; } const c = parse(getComputedStyle(document.body).backgroundColor); return c && c.a > 0 ? c : { r: 255, g: 255, b: 255, a: 1 }; };
  const out = [], seen = new Set();
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const text = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join("").trim();
    if (!text) continue;
    if (isInert(el)) continue;
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
  // `aria-hidden` and `inert` both remove a subtree from the accessibility
  // tree, so a control inside one cannot be an accessible-name or focus-ring
  // failure. Monaco's own `ime-text-area` is exactly this: a readonly,
  // tabindex="-1", aria-hidden="true" textarea that reported as unnamed.
  const isInert = (el) => Boolean(el.closest("[inert], [aria-hidden='true']"));
  const sel = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"]';
  const visible = (el) => { if (isInert(el)) return false; const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none") return false; if (el.hasAttribute("disabled")) return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
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
  // An icon-only control was the original target, but a bare unnamed form
  // control has no icon and was therefore never reported. Both are the same
  // failure: a focusable control a screen reader cannot announce.
  for (const el of els) {
    if (label(el)) continue;
    const iconOnly = Boolean(el.querySelector(".material-symbols-outlined, svg, img"));
    const bareControl = ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName);
    if (!iconOnly && !bareControl) continue;
    unnamed.push({ tag: el.tagName.toLowerCase(), type: el.getAttribute("type") || null, cls: String(el.getAttribute("class") || "").slice(0, 90) });
  }
  return { total: els.length, unnamed: unnamed.slice(0, 30) };
}

function auditFocusRing(limit = Infinity) {
  // `aria-hidden` and `inert` both remove a subtree from the accessibility
  // tree, so a control inside one cannot be an accessible-name or focus-ring
  // failure. Monaco's own `ime-text-area` is exactly this: a readonly,
  // tabindex="-1", aria-hidden="true" textarea that reported as unnamed.
  const isInert = (el) => Boolean(el.closest("[inert], [aria-hidden='true']"));
  const sel = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const visible = (el) => { if (isInert(el)) return false; const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none") return false; if (el.hasAttribute("disabled")) return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  const sig = (el) => { const cs = getComputedStyle(el); return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.borderColor].join("|"); };
  const indicated = (el) => { const cs = getComputedStyle(el); return (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== "none"); };
  const els = Array.from(document.querySelectorAll(sel)).filter(visible).slice(0, limit);
  const bad = [];
  for (const el of els) { const b = sig(el); el.focus({ preventScroll: true }); const changed = sig(el) !== b; const paints = indicated(el); el.blur(); if (!changed || !paints) bad.push({ tag: el.tagName.toLowerCase(), reason: !changed ? "no-change-on-focus" : "no-indicator-painted", cls: String(el.getAttribute("class") || "").slice(0, 90) }); }
  return { checked: els.length, bad: bad.slice(0, 20) };
}

// design-system.md section 6: "Minimum hit target is 32 pixels on pointer
// surfaces and 44 pixels on phones." Nothing measured that, so `hit-44` was
// applied by hand and could only be audited by grep. This measures the box a
// pointer can actually hit, `hit-44`'s pseudo-element overlay included, which
// is why it has to run in the browser rather than over the source.
function auditHitTargets(floor) {
  const isInert = (el) => Boolean(el.closest("[inert], [aria-hidden='true']"));
  const sel = 'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="switch"], [role="tab"]';
  const out = [];
  for (const el of Array.from(document.querySelectorAll(sel))) {
    if (isInert(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    if (el.hasAttribute("disabled")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    // A control inside a text run is exempt under SC 2.5.8: an inline link in a
    // sentence cannot be 44 tall without breaking the line it sits in.
    if (cs.display === "inline" && el.tagName === "A") continue;
    let w = r.width, h = r.height;
    // `hit-44` paints its target as an ::after overlay, which no rect on the
    // element itself reports. Read the overlay's own box. Replaced elements
    // (`input`, `select`, `textarea`) generate no pseudo-element box even though
    // `getComputedStyle` still answers for one, so crediting the overlay there
    // would be a false pass: those have to be enlarged by a real wrapper.
    const replaced = ["input", "select", "textarea", "img"].includes(el.tagName.toLowerCase());
    // A checkbox's activation region is the whole of its label: clicking the
    // label text toggles the box. Measuring the 16px glyph alone understates the
    // target a user can actually hit, so an associated label is measured
    // instead. `htmlFor` and the wrapping-label form are both associations.
    if (replaced) {
      const lab = el.closest("label") || (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
      if (lab) {
        const lr = lab.getBoundingClientRect();
        w = Math.max(w, lr.width);
        h = Math.max(h, lr.height);
      }
    }
    // An overlay bigger than its own element is only a real pointer target if
    // the element does not clip it. `truncate` carries `overflow: hidden`, so a
    // truncated link with `hit-44` computes a 44px overlay and hands the user a
    // box the size of the text. Crediting that is a false pass, which is worse
    // than the shortfall it hides, so a clipping element is measured on its own
    // rect. `visible` in one axis and `hidden` in the other still clips.
    const clips = cs.overflow !== "visible" || cs.overflowX !== "visible" || cs.overflowY !== "visible";
    const after = replaced || clips ? null : getComputedStyle(el, "::after");
    if (after && after.content !== "none" && after.position === "absolute") {
      w = Math.max(w, parseFloat(after.minWidth) || 0);
      h = Math.max(h, parseFloat(after.minHeight) || 0);
    }
    if (Math.min(w, h) + 0.5 >= floor) continue;
    out.push({ tag: el.tagName.toLowerCase(), w: Math.round(w), h: Math.round(h), cls: String(el.getAttribute("class") || "").slice(0, 80), cx: r.left + r.width / 2, cy: r.top + r.height / 2 });
  }
  // A target under the floor is still reachable if nothing else is within a
  // floor-sized box of it, which is WCAG 2.5.8's spacing exception. Splitting
  // the count this way separates a house-rule shortfall from a control a finger
  // genuinely cannot land on without hitting its neighbour. `small` stays the
  // strict number; `crowded` is the subset that actually costs a user a
  // mis-tap, so it is the one worth a layout change.
  const centres = [];
  for (const el of Array.from(document.querySelectorAll(sel))) {
    if (isInert(el) || el.hasAttribute("disabled")) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    centres.push([r.left + r.width / 2, r.top + r.height / 2]);
  }
  const crowded = out.filter((o) =>
    centres.some(([x, y]) => {
      if (Math.abs(x - o.cx) < 0.5 && Math.abs(y - o.cy) < 0.5) return false;
      return Math.abs(x - o.cx) < floor && Math.abs(y - o.cy) < floor;
    }),
  );
  const strip = ({ cx, cy, ...rest }) => rest;
  return { floor, checked: document.querySelectorAll(sel).length, small: out.length, crowded: crowded.length, sample: out.slice(0, 10).map(strip), crowdedSample: crowded.slice(0, 10).map(strip) };
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
  const isInert = (el) => Boolean(el.closest("[inert], [aria-hidden='true']"));
  const parse = (s) => { const m = (s || "").match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(",").map((x) => parseFloat(x.trim())); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const saturated = (c) => { if (!c || c.a < 0.4) return false; const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b); return mx - mn > 40; };
  const out = [];
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    if (isInert(el)) continue;
    if (el.closest("[aria-hidden='true']")) continue;
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
const results = { mode, base: redactEvidenceText(BASE), routes: {}, provenance };
const browser = await chromium.launch();
const authCtx = await browser.newContext({ baseURL: BASE });
const loginRes = await authCtx.request.post("/api/auth/login", { data: { password: PASSWORD }, headers: { "Content-Type": "application/json" } });
if (!loginRes.ok()) { console.error(`login failed: ${loginRes.status()}`); await browser.close(); process.exit(1); }
const [connectionsResponse, nodesResponse] = await Promise.all([
  authCtx.request.get("/api/providers"),
  authCtx.request.get("/api/provider-nodes"),
]);
if (!connectionsResponse.ok() || !nodesResponse.ok()) {
  console.error("privacy context unavailable; refusing to retain evidence");
  await browser.close();
  process.exit(4);
}
const privacyContext = buildEvidencePrivacyContext({
  connections: (await connectionsResponse.json()).connections || [],
  nodes: (await nodesResponse.json()).nodes || [],
});
const storageState = await authCtx.storageState();
await authCtx.close();

async function visit(name, path, theme, viewport, tag, { shot = true, zoom = false } = {}) {
  const ctx = await browser.newContext({ baseURL: BASE, storageState, viewport, colorScheme: theme, reducedMotion: "reduce" });
  await ctx.addInitScript((t) => { try { window.localStorage.setItem("theme", JSON.stringify({ state: { theme: t }, version: 0 })); } catch { /* blocked */ } }, theme);
  const page = await ctx.newPage();
  const consoleErrors = [], failedRequests = [], auditErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e.message).slice(0, 300)));
  page.on("requestfailed", (r) => { const why = r.failure()?.errorText || ""; if (why.includes("ERR_ABORTED")) return; failedRequests.push(`${r.method()} ${r.url().slice(0, 160)} ${why}`); });
  page.on("response", (r) => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url().slice(0, 160)}`); });

  let navError = null;
  try {
    const response = await page.goto(path, { waitUntil: "domcontentloaded", timeout: 45000 });
    if (!response || !response.ok()) {
      navError = `document response ${response?.status() || "missing"}`;
    } else if (new URL(page.url()).pathname !== path) {
      navError = `unexpected final path ${new URL(page.url()).pathname}`;
    }
    await page.waitForTimeout(2000);
  }
  catch (e) { navError = String(e.message).split("\n")[0]; }

  const r = { path, navError, consoleErrors, failedRequests, auditErrors };
  if (!navError) {
    if (zoom) {
      try { r.reflow = await page.evaluate(auditReflow); }
      catch { auditErrors.push("reflow evaluation failed"); }
    }
    else {
      try { r.contrast = (await page.evaluate(auditContrast)) || []; } catch { r.contrast = []; auditErrors.push("contrast evaluation failed"); }
      try { r.names = (await page.evaluate(auditNames)) || { total: 0, unnamed: [] }; } catch { r.names = { total: 0, unnamed: [] }; auditErrors.push("accessible-name evaluation failed"); }
      try { r.focus = (await page.evaluate(auditFocusRing)) || { checked: 0, bad: [] }; } catch { r.focus = { checked: 0, bad: [] }; auditErrors.push("focus evaluation failed"); }
      try { r.hueOnly = (await page.evaluate(auditHueOnly)) || []; } catch { r.hueOnly = []; auditErrors.push("status-cue evaluation failed"); }
      // 44 on the phone viewport, 32 on pointer surfaces, exactly as the
      // design system splits it.
      try { r.hitTargets = await page.evaluate(auditHitTargets, tag === "phone" ? 44 : 32); }
      catch { auditErrors.push("hit-target evaluation failed"); }
      // Keyboard traversal: tab through and record what receives focus, and
      // whether focus ever escapes into nothing (a trap or a dead end).
      if (tag === "desktop" && theme === "dark") {
        const seq = [];
        let escaped = false;
        try {
          // auditFocusRing focuses and blurs every candidate, which leaves the
          // sequential-focus starting point past the end of the document. Reset
          // it, or the first Tab lands nowhere and every route falsely reports
          // an escaped focus.
          await page.evaluate(() => document.documentElement.focus());
          // A single empty step is the document boundary: focus leaves for the
          // browser chrome and the next Tab re-enters at the top. Only focus
          // that never comes back is a dead end, so escape needs two in a row.
          let empties = 0;
          for (let i = 0; i < 41; i++) {
            await page.keyboard.press("Tab");
            const cur = await page.evaluate(() => {
              const a = document.activeElement; if (!a || a === document.body) return null;
              const c = a.cloneNode(true); c.querySelectorAll?.(".material-symbols-outlined,svg,img").forEach((n) => n.remove());
              // Resolve the name the same way auditNames does. A weaker rule here
              // reported a control named by <label for>, a wrapping <label>, or
              // title as an unnamed tab stop, which is a false accessibility
              // failure and hid the genuinely unnamed ones among the noise.
              const lb = a.getAttribute("aria-labelledby");
              const forId = a.getAttribute("id");
              const name = a.getAttribute("aria-label")
                || a.getAttribute("title")
                || (lb && document.getElementById(lb.split(/\s+/)[0])
                  ? (document.getElementById(lb.split(/\s+/)[0]).textContent || "").replace(/\s+/g, " ").trim()
                  : "")
                || (c.textContent || "").replace(/\s+/g, " ").trim()
                || a.getAttribute("placeholder")
                || (forId && document.querySelector(`label[for="${forId}"]`)
                  ? (document.querySelector(`label[for="${forId}"]`).textContent || "").replace(/\s+/g, " ").trim()
                  : "")
                || (a.closest("label")
                  ? (a.closest("label").textContent || "").replace(/\s+/g, " ").trim()
                  : "");
              return { tag: a.tagName.toLowerCase(), name: (name || "").slice(0, 50) };
            });
            if (!cur) {
              if (++empties > 1) { escaped = true; break; }
              continue;
            }
            empties = 0;
            // The traversal wrapped back to the first control; the cycle is closed.
            if (seq.length && seq[0].tag === cur.tag && seq[0].name === cur.name) break;
            seq.push(cur);
          }
        } catch { auditErrors.push("tab-order evaluation failed"); }
        r.tabOrder = { steps: seq.length, escaped, unnamed: seq.filter((s) => !s.name).length, sequence: seq.slice(0, 40) };
      }
    }
  }
  // Measurements must observe the shipped DOM. Redaction happens only after
  // them. Script execution is then frozen so a live React timer cannot restore
  // sensitive state between masking and pixel capture.
  let captureReady = false;
  if (!navError && shot) {
    try {
      const captureSession = await ctx.newCDPSession(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      // The tab-order audit above leaves the last control focused, and the skip
      // link is `sr-only focus:not-sr-only`, so it was still visible at capture
      // and every dark desktop screenshot showed a skip pill overlapping the
      // masthead. That is the audit's own focus, not a layout defect. Blur it,
      // so the screenshot shows the resting state a reviewer is judging.
      await page.evaluate(() => document.activeElement?.blur?.());
      await page.evaluate(maskEvidenceDom, privacyContext);
      // Pausing virtual time can block Chromium's screenshot compositor. Freezing
      // scripts still prevents React timers from restoring private capture text.
      await captureSession.send("Emulation.setScriptExecutionDisabled", { value: true });
      captureReady = true;
    }
    catch { auditErrors.push("evidence masking failed"); }
  }
  if (captureReady) {
    try {
      await page.screenshot({ path: `${OUT}/${name}--${theme}--${tag}.png`, fullPage: false });
    }
    catch { auditErrors.push("screenshot capture failed"); }
  }
  const evidence = redactEvidenceValue(r, privacyContext);
  results.routes[`${name}|${theme}|${tag}`] = evidence;
  const n = (x) => (x || []).length;
  console.log(`${name}|${theme}|${tag}  err=${n(evidence.consoleErrors)} net=${n(evidence.failedRequests)} contrast=${n(evidence.contrast)} unnamed=${n(evidence.names?.unnamed)} nofocus=${n(evidence.focus?.bad)} hue=${n(evidence.hueOnly)} smallhit=${evidence.hitTargets?.small ?? "-"} crowdedhit=${evidence.hitTargets?.crowded ?? "-"}${evidence.reflow ? ` overflow=${evidence.reflow.overflow}` : ""}${navError ? " NAV_ERROR" : ""}`);
  await ctx.close();
}

for (const [name, path] of ROUTES) {
  for (const theme of ["light", "dark"]) for (const [tag, vp] of VIEWS) await visit(name, path, theme, vp, tag);
  await visit(name, path, "dark", ZOOM200, "zoom200", { shot: true, zoom: true });
}
await browser.close();
mkdirSync("docs/design/evidence/raw", { recursive: true });
writeFileSync(`docs/design/evidence/raw/${mode}.json`, JSON.stringify(results, null, 2));
const tot = (f) => Object.values(results.routes).reduce((a, r) => a + f(r), 0);
console.log(`\n${mode}: views=${Object.keys(results.routes).length} consoleErrors=${tot((r) => (r.consoleErrors || []).length)} failedRequests=${tot((r) => (r.failedRequests || []).length)} contrastFailures=${tot((r) => (r.contrast || []).length)} unnamedIconControls=${tot((r) => (r.names?.unnamed || []).length)} focusRingFailures=${tot((r) => (r.focus?.bad || []).length)} hueOnly=${tot((r) => (r.hueOnly || []).length)} smallHitTargets=${tot((r) => r.hitTargets?.small || 0)} crowdedHitTargets=${tot((r) => r.hitTargets?.crowded || 0)} reflowOverflow=${tot((r) => (r.reflow?.overflow ? 1 : 0))}`);
