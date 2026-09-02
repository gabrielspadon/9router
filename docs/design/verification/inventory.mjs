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

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  buildEvidencePrivacyContext,
  redactEvidenceValue,
  redactInventoryRecords,
} from "./redactEvidence.mjs";
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
const fileProvenance = process.env.INVENTORY_PROVENANCE_FILE
  ? provenanceFromFile(process.env.INVENTORY_PROVENANCE_FILE)
  : {};
const provenance = {
  seedDigest: process.env.INVENTORY_SEED_DIGEST || null,
  sourceRevision: fileProvenance.sourceRevision || process.env.INVENTORY_SOURCE_REVISION || null,
  buildId: fileProvenance.buildId || process.env.INVENTORY_BUILD_ID || null,
};
const ALL_ROUTES = [
  ["landing", "/landing"],
  ["dashboard-home", "/dashboard"],
  ["providers", "/dashboard/providers"],
  ["providers-new", "/dashboard/providers/new"],
  // The add-connection form moved off /providers/new into a modal on the
  // provider detail route, so the inventory has to walk that route or the form
  // reads as a capability loss when it is only relocated.
  ["provider-detail", "/dashboard/providers/codex"],
  // codex authenticates by OAuth, so its Add button opens the OAuth modal. The
  // API-key connection form the baseline had on /providers/new now lives behind
  // Add on an API-key provider's detail route, so walking only codex reported
  // that whole form as a capability loss.
  ["provider-detail-apikey", "/dashboard/providers/deepseek"],
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
const ROUTES = ALL_ROUTES.filter(([n]) => (!ONLY || n === ONLY) && n !== SKIP);
// Quota hydrates connection rows after its route shell. Sampling it at the
// default route settle time turns a present action into a false parity loss.
const ROUTE_SETTLE_MS = { quota: 8000 };

// The one selector both the in-page collector and the re-click use, so a
// control's recorded index addresses the same element on the next load.
const SEL = [
  "button", "a[href]", "input", "select", "textarea", "summary",
  "[role=button]", "[role=tab]", "[role=switch]", "[role=menuitem]",
  "[role=checkbox]", "[role=radio]", "[role=combobox]", "[role=link]",
  "[contenteditable=true]", "[tabindex]:not([tabindex='-1'])",
].join(",");

// Runs inside the page. Returns one record per interactive control.
function collect([depth, SEL]) {
  const DESTRUCTIVE =
    /\b(delete|remove|destroy|reset|clear all|revoke|uninstall|wipe|drop)\b|删除|移除|清空|重置|撤销/i;

  const name = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim();
    const lb = el.getAttribute("aria-labelledby");
    if (lb) {
      const t = lb.split(/\s+/).map((id) => document.getElementById(id))
        .filter(Boolean).map((n) => n.textContent.trim()).join(" ").trim();
      if (t) return t;
    }
    const tag = el.tagName.toLowerCase();
    // Fields inherit their accessible name from the associated label. Buttons
    // often carry live state in their text, so preserve that state for the
    // capability inventory rather than replacing it with a static field label.
    if (el.id && ["input", "select", "textarea"].includes(tag)) {
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
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l && l.textContent.trim()) return l.textContent.trim();
    }
    const ph = el.getAttribute("placeholder");
    if (ph && ph.trim()) return ph.trim();
    // A control wrapped in its own <label> is named by that label (HTML-AAM).
    // Without this a "Select All" checkbox nested in a label read as unnamed,
    // which is a false accessibility failure and a false capability loss.
    const wrap = el.closest("label");
    if (wrap) {
      const wc = wrap.cloneNode(true);
      wc.querySelectorAll("input,select,textarea,.material-symbols-outlined,svg").forEach((n) => n.remove());
      const wt = (wc.textContent || "").replace(/\s+/g, " ").trim();
      if (wt) return wt;
    }
    return "";
  };

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.01;
  };

  const out = [];
  const all = [...document.querySelectorAll(SEL)];
  for (let idx = 0; idx < all.length; idx++) {
    const el = all[idx];
    if (!visible(el)) continue;
    if (el.closest("[aria-hidden='true']")) continue;
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role") ||
      (tag === "a" ? "link" : tag === "button" ? "button" :
       tag === "input" ? `input:${(el.getAttribute("type") || "text").toLowerCase()}` : tag);
    // XYFlow made inert topology edges focusable groups. A group with no
    // operation is neither a control nor a capability this inventory can lose.
    if (role === "group") continue;
    const n = name(el);
    let dest = "";
    if (tag === "a") {
      const h = el.getAttribute("href") || "";
      try { dest = h ? new URL(h, location.href).pathname : ""; } catch { dest = h; }
      if (el.target === "_blank") dest += " (new tab)";
    }
    // A link that leaves this path is navigation, not disclosure. Clicking it
    // attributes the destination route's controls to this one, which inflated
    // every route by the profile page and made the count depend on whether the
    // click won a race with hydration.
    const navigatesAway = tag === "a" && dest && dest !== location.pathname;
    const disclosure = !navigatesAway && (
      el.hasAttribute("aria-expanded") || el.hasAttribute("aria-haspopup") ||
      role === "tab" || tag === "summary" ||
      // "Add connection" opens a modal without declaring aria-haspopup, so the
      // form it contains is invisible to a flat pass and reads as a lost
      // capability when it has only moved into a dialog.
      /\b(more|advanced|options|show|expand|details|settings|filter|add|new)\b|更多|高级|展开|详情|设置|添加|新建/i.test(n));
    out.push({
      role, name: n, dest, depth, idx,
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

const [connectionsResponse, nodesResponse] = await Promise.all([
  ctx.request.get(`${BASE}/api/providers`),
  ctx.request.get(`${BASE}/api/provider-nodes`),
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

const routes = {};
for (const [id, path] of ROUTES) {
  try {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(ROUTE_SETTLE_MS[id] || 1400);
  } catch (e) {
    routes[id] = { path, error: String(e).slice(0, 160), controls: [] };
    console.log(`${id}: NAV FAILED`);
    continue;
  }

  const flat = await page.evaluate(collect, [0, SEL]);
  const seen = new Map(flat.map((c) => [c.key, c]));

  // One level of disclosure, non-destructive only.
  const openers = flat.filter((c) => c.disclosure && !c.destructive && !c.disabled);
  for (const o of openers.slice(0, 14)) {
    try {
      // Click the element the collector actually recorded, by its index in the
      // same selector. Re-finding it by `:has-text` matched a substring, so
      // "Add" opened "Bulk Add" and the real Add-connection modal was never
      // walked; its whole form then read as a capability loss.
      const handle = await page.evaluateHandle(
        ([sel, idx]) => document.querySelectorAll(sel)[idx] || null, [SEL, o.idx]);
      const el = handle.asElement();
      if (el) {
        await el.click({ timeout: 2500 });
        await page.waitForTimeout(500);
        // Second line of defence: a control that turned out to navigate leaves
        // us on another route, whose controls are not this route's capabilities.
        if (new URL(page.url()).pathname === path) {
          const revealed = await page.evaluate(collect, [1, SEL]);
          for (const c of revealed) if (!seen.has(c.key)) seen.set(c.key, { ...c, via: o.name });
        }
      }
      await handle.dispose();
    } catch { /* a disclosure that will not open is not a capability loss */ }
    finally {
      // Escape does not always dismiss a modal, and a leftover overlay swallows
      // the next opener's click, which made the capture order-dependent. Each
      // disclosure therefore starts from a freshly loaded route. This has to run
      // on every path out of the block: an early `continue` used to skip it, so
      // the next opener re-clicked an index against a page it did not belong to.
      try {
        await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(ROUTE_SETTLE_MS[id] || 1400);
      } catch { /* the next opener will fail its own count check */ }
    }
  }

  // `idx` is a DOM position used only to re-click a disclosure; it is not part
  // of the capability record and would churn the evidence on any layout change.
  const controls = redactInventoryRecords(
    [...seen.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(({ idx, ...c }) => c),
    privacyContext,
  );
  routes[id] = { path, controls };
  console.log(`${id}: ${controls.length} controls (${controls.filter((c) => c.depth === 1).length} behind disclosure)`);
}

mkdirSync("docs/design/evidence/raw", { recursive: true });
const total = Object.values(routes).reduce((n, r) => n + (r.controls?.length || 0), 0);
const evidence = redactEvidenceValue(
  { mode, base: BASE, capturedRoutes: Object.keys(routes).length, total, routes, pageErrors: errors, provenance },
  privacyContext,
);
writeFileSync(`docs/design/evidence/raw/inventory-${mode}.json`,
  JSON.stringify(evidence, null, 2));
console.log(`\n${mode}: ${total} controls across ${Object.keys(routes).length} routes -> docs/design/evidence/raw/inventory-${mode}.json`);
await browser.close();
