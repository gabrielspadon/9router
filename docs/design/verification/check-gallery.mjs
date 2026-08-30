#!/usr/bin/env node
// The gallery route exists, covers every primitive the design system claims to
// own, and has committed snapshots so a visual regression is caught.
import { existsSync, readFileSync, readdirSync } from "node:fs";
const PAGE = "src/app/(dashboard)/dashboard/gallery/page.js";
const SHOTS = "docs/design/evidence/gallery";
const problems = [];

if (!existsSync(PAGE)) { console.log(`missing ${PAGE}`); process.exit(1); }
const src = readFileSync(PAGE, "utf8");

// Every primitive the component layer is authoritative for has to appear.
const REQUIRED = ["Button", "Badge", "Card", "Input", "Select", "Toggle",
  "Skeleton", "EmptyState", "ErrorState", "StatusToken", "Readout",
  "DataTable", "ChannelList"];
for (const c of REQUIRED) if (!new RegExp(`<${c}[\\s/>]`).test(src)) problems.push(`gallery does not render ${c}`);

// The states the brief names have to be represented, not just the happy path.
const STATES = [["disabled", /disabled/], ["empty", /<EmptyState/], ["error", /<ErrorState/], ["loading", /<Skeleton/]];
for (const [name, re] of STATES) if (!re.test(src)) problems.push(`gallery does not show the ${name} state`);

// A gallery with handlers can drift from the components it documents, and a
// handler here would also move the behavioural fingerprint.
const handlers = [...src.matchAll(/\bon[A-Z]\w*\s*=\s*\{/g)].map((m) => m[0]);
if (handlers.length) problems.push(`gallery declares ${handlers.length} handlers: ${handlers.slice(0, 4).join(" ")}`);

// Icon-only controls in the gallery must model the rule they document.
const iconOnly = [...src.matchAll(/<Button[^>]*size="icon[^"]*"[^>]*>/g)];
for (const m of iconOnly) if (!/aria-label=/.test(m[0])) problems.push(`icon-only Button without an accessible name: ${m[0].slice(0, 60)}`);

const shots = existsSync(SHOTS) ? readdirSync(SHOTS).filter((f) => f.endsWith(".png")) : [];
console.log(`gallery: ${REQUIRED.length} primitives required, ${handlers.length} handlers, ${shots.length} snapshots`);
for (const theme of ["light", "dark"])
  if (!shots.some((f) => f.includes(theme))) problems.push(`no committed ${theme} snapshot in ${SHOTS}`);

if (problems.length) { problems.forEach((p) => console.log("  " + p)); process.exit(1); }
console.log("GALLERY OK");
