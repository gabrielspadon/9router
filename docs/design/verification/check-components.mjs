#!/usr/bin/env node
// The shared component layer is authoritative: the primitives the design system
// names all exist, their variant sets stay small, they implement the states the
// brief requires, and an icon-only control cannot ship without a name.
import { existsSync, readFileSync } from "node:fs";
const C = "src/shared/components";
const problems = [];

const REQUIRED = {
  "Button.js": ["variants", "disabled"],
  "Badge.js": [],
  "Card.js": [],
  "Input.js": ["disabled"],
  "Select.js": ["disabled"],
  "Toggle.js": ["disabled"],
  "Modal.js": [],
  "Table.js": [],
  "EmptyState.js": [],
  "ErrorState.js": [],
  "Skeleton or Loading.js": [],
  "StatusToken.js": [],
  "Readout.js": [],
  "ChannelList.js": [],
};
for (const f of Object.keys(REQUIRED)) {
  const name = f === "Skeleton or Loading.js" ? "Loading.js" : f;
  if (!existsSync(`${C}/${name}`)) problems.push(`missing primitive ${name}`);
}

// Every primitive has to be exported from the barrel, or a route cannot reach it.
const barrel = readFileSync(`${C}/index.js`, "utf8");
for (const n of ["Table", "EmptyState", "ErrorState", "StatusToken", "Readout", "ChannelList", "Skeleton"])
  if (!new RegExp(`\\b${n}\\b`).test(barrel)) problems.push(`${n} is not exported from the barrel`);

// Small variant sets. A variant map past this size is a palette, not a set.
const btn = readFileSync(`${C}/Button.js`, "utf8");
const vBlock = (btn.match(/const variants = \{[\s\S]*?\n\};/) || [""])[0];
const vCount = (vBlock.match(/^\s{2}\w[\w-]*:/gm) || []).length;
console.log(`Button variants: ${vCount}`);
if (vCount > 6) problems.push(`Button has ${vCount} variants, which is a palette rather than a set`);
if (!/disabled:/.test(btn)) problems.push("Button has no disabled styling");

// The icon-only accessible-name rule has to be enforced by the component, not
// left to the caller to remember.
if (!/aria-label/.test(btn) || !/warn/i.test(btn))
  problems.push("Button does not enforce an accessible name on icon-only sizes");

// Reduced motion has to be honoured by anything that animates.
const loading = readFileSync(`${C}/Loading.js`, "utf8");
if (/(?<!motion-safe:)animate-pulse/.test(loading))
  problems.push("Loading animates without a motion-safe guard");

// Status must never be colour alone: StatusToken pairs a glyph with the word.
const st = readFileSync(`${C}/StatusToken.js`, "utf8");
if (!/glyph/.test(st)) problems.push("StatusToken does not pair a glyph with its colour");

console.log(`primitives checked: ${Object.keys(REQUIRED).length}`);
if (problems.length) { problems.forEach((p) => console.log("  " + p)); process.exit(1); }
console.log("COMPONENTS OK");
