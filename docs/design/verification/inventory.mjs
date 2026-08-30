#!/usr/bin/env node
// Capability inventory. Walks every route in a real browser and records every
// interactive control: what it is, what it says, and where it goes or what it
// opens. Run once before the redesign and once after; check-inventory.mjs then
// proves nothing became unreachable.
//
// Controls hidden behind disclosure are found too: after the flat pass, every
// control that looks like a disclosure (aria-expanded, aria-haspopup, a tab, a
// <summary>, or a "more/advanced" label) is opened once and the newly revealed
// controls are recorded at depth 1. The contract allows a capability to sit one
// action deep; this is how that is measured rather than assumed.
//
// Nothing destructive is ever clicked: names matching the destructive pattern
// are recorded and skipped, and no form is submitted.
//
//   node docs/design/verification/inventory.mjs before http://127.0.0.1:20135
//   node docs/design/verification/inventory.mjs after  http://127.0.0.1:20135
//
// Playwright is not a dependency of this repository. Point NODE_PATH at an
// installation that has it, for example:
//   NODE_PATH=$(npm root -g) node docs/design/verification/audit2.mjs after

import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const mode = process.argv[2];
const BASE = process.argv[3] || "http://127.0.0.1:20135";
const PASSWORD = process.env.SMOKE_PASSWORD || "123456";
if (!["before", "after"].includes(mode)) {
  console.error("usage: inventory.mjs <before|after> [baseUrl]");
  process.exit(2);
}

const ONLY = process.env.ONLY_ROUTE || "";
const ALL_ROUTES = [
  ["landing", "/landing"],
  ["dashboard-home", "/dashboard"],
  ["providers", "/dashboard/providers"],
  ["providers-new", "/dashboard/providers/new"],
  ["statistics", "/dashboard/statistics"],
  ["usage", "/dashboard/usage"],
  ["quota", "/dashboard/quota"],
  ["endpoint", "/dashboard/endpoint"],
  ["combos", "/dashboard/combos"],
  ["cli-tools", "/dashboard/cli-tools"],
  ["claude-compat", "/dashboard/claude-compat"],
  ["basic-chat", "/dashboard/basic-chat"],
  ["console-log", "/dashboard/console-log"],
  ["media-providers", "/dashboard/media-providers/web"],
  ["memory", "/dashboard/memory"],
  ["mitm", "/dashboard/mitm"],
  ["model-context", "/dashboard/model-context"],
  ["profile", "/dashboard/profile"],
  ["proxy-pools", "/dashboard/proxy-pools"],
  ["pxpipe", "/dashboard/pxpipe"],
  ["skills", "/dashboard/skills"],
  ["token-saver", "/dashboard/token-saver"],
  ["translator", "/dashboard/translator"],
];
const ROUTES = ALL_ROUTES.filter(([n]) => !ONLY || n === ONLY);

// Runs inside the page. Returns one record per interactive control.
function collect(depth) {
  const DESTRUCTIVE =
    /\b(delete|remove|destroy|reset|clear all|revoke|uninstall|wipe|drop)\b|删除|移除|清空|重置|撤销/i;
  const SEL = [
    "button", "a[href]", "input", "select", "textarea", "summary",
    "[role=button]", "[role=tab]", "[role=switch]", "[role=menuitem]",
    "[role=checkbox]", "[role=radio]", "[role=combobox]", "[role=link]",
    "[contenteditable=true]", "[tabindex]:not([tabindex='-1'])",
  ].join(",");

  const name = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim();
    const lb = el.getAttribute("aria-labelledby");
    if (lb) {
      const t = lb.split(/\s+/).map((id) => document.getElementById(id))
        .filter(Boolean).map((n) => n.textContent.trim()).join(" ").trim();
      if (t) return t;
    }
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l && l.textContent.trim()) return l.textContent.trim();
    }
    const ttl = el.getAttribute("title");
    if (ttl && ttl.trim()) return ttl.trim();
    // Strip icon-ligature carriers so a material-icons glyph is not read as a name.
    const clone = el.cloneNode(true);
    clone.querySelectorAll(
      ".material-icons,.material-symbols-outlined,[class*='material-icons'],[class*='material-symbols'],svg,[aria-hidden='true']"
    ).forEach((n) => n.remove());
    const txt = (clone.textContent || "").replace(/\s+/g, " ").trim();
    if (txt) return txt;
    const ph = el.getAttribute("placeholder");
    if (ph && ph.trim()) return ph.trim();
    return "";
  };

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.01;
  };

  const out = [];
  for (const el of document.querySelectorAll(SEL)) {
    if (!visible(el)) continue;
    if (el.closest("[aria-hidden='true']")) continue;
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role") ||
      (tag === "a" ? "link" : tag === "button" ? "button" :
       tag === "input" ? `input:${(el.getAttribute("type") || "text").toLowerCase()}` : tag);
    const n = name(el);
    let dest = "";
    if (tag === "a") {
      const h = el.getAttribute("href") || "";
      try { dest = h ? new URL(h, location.href).pathname : ""; } catch { dest = h; }
      if (el.target === "_blank") dest += " (new tab)";
    }
    const disclosure =
      el.hasAttribute("aria-expanded") || el.hasAttribute("aria-haspopup") ||
      role === "tab" || tag === "summary" ||
      /\b(more|advanced|options|show|expand|details|settings|filter)\b|更多|高级|展开|详情|设置/i.test(n);
    out.push({
      role, name: n, dest, depth,
      disclosure: !!disclosure,
      destructive: DESTRUCTIVE.test(n),
      disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
      key: `${role}|${n}|${dest}`,
    });
  }
  return out;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

// ---- login ----
// Through the API rather than the form: the context's request object shares the
// cookie jar, so the session lands without depending on a form selector that the
// redesign is about to change.
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
let loggedIn = false;
try {
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { password: PASSWORD } });
  loggedIn = r.ok();
} catch { /* fall through to the form */ }
if (!loggedIn) {
  const pw = page.locator('input[type="password"]').first();
  if (await pw.count()) {
    await pw.fill(PASSWORD);
    await page.locator('button[type="submit"], form button').first().click().catch(() => {});
    await page.waitForTimeout(2500);
  }
}
await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
loggedIn = !/\/login/.test(page.url());
console.log(`login: ${loggedIn ? "ok" : "FAILED"} (${page.url()})`);
if (!loggedIn) {
  console.log("cannot walk the dashboard without a session; set SMOKE_PASSWORD");
  await browser.close();
  process.exit(3);
}

const routes = {};
for (const [id, path] of ROUTES) {
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1400);
  } catch (e) {
    routes[id] = { path, error: String(e).slice(0, 160), controls: [] };
    console.log(`${id}: NAV FAILED`);
    continue;
  }

  const flat = await page.evaluate(collect, 0);
  const seen = new Map(flat.map((c) => [c.key, c]));

  // One level of disclosure, non-destructive only.
  const openers = flat.filter((c) => c.disclosure && !c.destructive && !c.disabled);
  for (const o of openers.slice(0, 14)) {
    try {
      const loc = page.locator(
        o.name ? `:is(button,summary,[role=tab],[role=button],a):has-text("${o.name.replace(/"/g, '\\"').slice(0, 40)}")`
               : "button"
      ).first();
      if (!(await loc.count())) continue;
      await loc.click({ timeout: 2500 });
      await page.waitForTimeout(500);
      const revealed = await page.evaluate(collect, 1);
      for (const c of revealed) if (!seen.has(c.key)) seen.set(c.key, { ...c, via: o.name });
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(150);
    } catch { /* a disclosure that will not open is not a capability loss */ }
  }

  const controls = [...seen.values()].sort((a, b) => a.key.localeCompare(b.key));
  routes[id] = { path, controls };
  console.log(`${id}: ${controls.length} controls (${controls.filter((c) => c.depth === 1).length} behind disclosure)`);
}

mkdirSync("docs/design/evidence/raw", { recursive: true });
const total = Object.values(routes).reduce((n, r) => n + (r.controls?.length || 0), 0);
writeFileSync(`docs/design/evidence/raw/inventory-${mode}.json`,
  JSON.stringify({ mode, base: BASE, capturedRoutes: Object.keys(routes).length, total, routes, pageErrors: errors }, null, 2));
console.log(`\n${mode}: ${total} controls across ${Object.keys(routes).length} routes -> docs/design/evidence/raw/inventory-${mode}.json`);
await browser.close();
