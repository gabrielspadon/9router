#!/usr/bin/env node
// Areas left alone on purpose are listed with a reason each, so "unchanged"
// is a decision on the record rather than something that was forgotten.
import { existsSync, readFileSync } from "node:fs";
const DOC = "docs/design/not-changed.md";
if (!existsSync(DOC)) { console.log(`missing ${DOC}`); process.exit(1); }
const t = readFileSync(DOC, "utf8");
const rows = t.split("\n").filter((l) => /^\|/.test(l) && !/^\|\s*-+/.test(l));
const body = rows.slice(1); // drop the header row
const problems = [];
if (body.length < 3) problems.push(`only ${body.length} areas listed`);
body.forEach((r) => {
  const cells = r.split("|").map((c) => c.trim()).filter(Boolean);
  if (cells.length < 2 || cells[1].length < 20)
    problems.push(`no substantive reason for: ${cells[0] || r.slice(0, 40)}`);
});
console.log(`not-changed: ${body.length} areas, each with a reason`);
if (problems.length) { problems.slice(0, 12).forEach((p) => console.log("  " + p)); process.exit(1); }
console.log("NOTCHANGED OK");
