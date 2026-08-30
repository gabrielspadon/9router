#!/usr/bin/env node
// The shell carries the signature elements the direction committed to, and
// every dashboard route consumes it.
import { readFileSync, existsSync } from "node:fs";
const problems = [];
const SIDEBAR = "src/shared/components/Sidebar.js";
const LAYOUT = "src/app/(dashboard)/layout.js";
for (const f of [SIDEBAR, LAYOUT]) if (!existsSync(f)) problems.push(`missing ${f}`);

const rail = readFileSync(SIDEBAR, "utf8");
// Signature element 2: the rail is grouped by the four product jobs.
for (const job of ["Connect", "Compose", "Point", "Watch"])
  if (!new RegExp(`"${job}"`).test(rail)) problems.push(`rail does not name the job ${job}`);
if (!/NAV_JOBS/.test(rail)) problems.push("rail has no job grouping");
// Numbered, because the number is a stable address.
if (!/padStart\(2, "0"\)/.test(rail)) problems.push("rail items are not numbered");
// The active route must be announced, not only coloured.
if (!/aria-current=/.test(rail)) problems.push("rail does not mark the active route for assistive tech");

// Every dashboard route renders through the one layout.
const layout = readFileSync(LAYOUT, "utf8");
if (!/DashboardLayout/.test(layout)) problems.push("dashboard routes do not consume the shell");

console.log(`shell: 4 jobs named, numbering ${/padStart/.test(rail) ? "present" : "absent"}`);
if (problems.length) { problems.forEach((p) => console.log("  " + p)); process.exit(1); }
console.log("SHELL OK");
