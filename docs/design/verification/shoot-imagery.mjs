#!/usr/bin/env node
// Regenerates the repository's hero and documentation imagery from the running
// interface, so the pictures in the README are the product as it is now rather
// than as it was two designs ago.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://127.0.0.1:20135";
const PASSWORD = process.env.SMOKE_PASSWORD || "123456";
const SHOTS = [
  { out: "images/9router.png", path: "/dashboard/providers", theme: "dark", w: 1440, h: 900 },
  { out: "images/fusion-combo-ui.png", path: "/dashboard/combos", theme: "dark", w: 1280, h: 820 },
  { out: "docs/design/evidence/hero/statistics.png", path: "/dashboard/statistics", theme: "dark", w: 1440, h: 900 },
  { out: "docs/design/evidence/hero/endpoint-light.png", path: "/dashboard/endpoint", theme: "light", w: 1440, h: 900 },
  // The component gallery is the visual regression snapshot for the shared
  // primitives, so it is regenerated here rather than captured by hand.
  { out: "docs/design/evidence/gallery/gallery--light.png", path: "/dashboard/gallery", theme: "light", w: 1440, h: 900, full: true },
  { out: "docs/design/evidence/gallery/gallery--dark.png", path: "/dashboard/gallery", theme: "dark", w: 1440, h: 900, full: true },
];
mkdirSync("docs/design/evidence/hero", { recursive: true });
mkdirSync("docs/design/evidence/gallery", { recursive: true });

const b = await chromium.launch();
const auth = await b.newContext({ baseURL: BASE });
const r = await auth.request.post("/api/auth/login", { data: { password: PASSWORD }, headers: { "Content-Type": "application/json" } });
if (!r.ok()) { console.error(`login failed ${r.status()}`); process.exit(1); }
const storageState = await auth.storageState();
await auth.close();

for (const s of SHOTS) {
  const ctx = await b.newContext({
    baseURL: BASE, storageState, viewport: { width: s.w, height: s.h },
    colorScheme: s.theme, reducedMotion: "reduce", deviceScaleFactor: 2,
  });
  await ctx.addInitScript((t) => {
    try { localStorage.setItem("theme", JSON.stringify({ state: { theme: t }, version: 0 })); } catch { /* blocked */ }
  }, s.theme);
  const p = await ctx.newPage();
  await p.goto(s.path, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(2200);
  await p.screenshot({ path: s.out, fullPage: !!s.full });
  console.log(`${s.out}  ${s.path} ${s.theme} ${s.w}x${s.h}`);
  await ctx.close();
}
await b.close();
