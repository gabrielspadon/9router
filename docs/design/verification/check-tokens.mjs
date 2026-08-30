#!/usr/bin/env node
// The token layer is the only place a colour is decided. This fails when a
// component or route hardcodes a raw colour instead of reaching for a token.
//
// Allowed outside the token layer: transparent, currentColor, inherit, the
// eight-digit alpha forms of black and white used for scrims, and colours
// inside a provider brand asset.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const files = (spawnSync("git", ["ls-files", "src"], { encoding: "utf8" }).stdout || "")
  .split("\n").filter((f) => /\.(jsx?|css)$/.test(f) && f !== "src/app/globals.css");

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const RGB = /\brgba?\(\s*\d+[\s,]/g;
const ALLOW = /^#(fff|ffffff|000|000000)$/i;
const offenders = [];
for (const f of files) {
  let text;
  try { text = readFileSync(f, "utf8"); } catch { continue; }
  const hits = [];
  for (const m of text.matchAll(HEX)) if (!ALLOW.test(m[0])) hits.push(m[0]);
  for (const m of text.matchAll(RGB)) hits.push(m[0].trim());
  if (hits.length) offenders.push({ f, n: hits.length, sample: [...new Set(hits)].slice(0, 4) });
}
offenders.sort((a, b) => b.n - a.n);
const total = offenders.reduce((a, o) => a + o.n, 0);
console.log(`scanned ${files.length} files outside the token layer`);
console.log(`RAW_COLOURS=${total} in ${offenders.length} files`);
offenders.slice(0, 20).forEach((o) => console.log(`  ${o.n.toString().padStart(4)} ${o.f}  ${o.sample.join(" ")}`));

// A ratchet rather than zero. Provider brand marks legitimately carry their own
// colours (a vendor's orange is data, not styling), so the honest gate is that
// this number never grows. Lower it whenever a real offender is tokenised.
const CEILING = 120;
if (total > CEILING) {
  console.log(`RAW_COLOURS grew past the ceiling of ${CEILING}`);
  process.exit(1);
}
if (total < CEILING) console.log(`below ceiling ${CEILING}; lower CEILING to ${total}`);
console.log("TOKENS OK");
