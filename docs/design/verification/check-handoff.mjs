#!/usr/bin/env node
// Backend-dependent findings are routed with enough for someone else to act:
// the file, the line, the reason, the recommended owner, and what shipped in
// its place. A finding without a line number is a complaint, not a handoff.
import { existsSync, readFileSync } from "node:fs";
const DOC = "docs/design/backend-handoff.md";
if (!existsSync(DOC)) { console.log(`missing ${DOC}`); process.exit(1); }
const t = readFileSync(DOC, "utf8");
const problems = [];
const findings = t.split(/\n## /).slice(1);
if (!findings.length) problems.push("no findings recorded");
findings.forEach((f, i) => {
  const title = f.split("\n")[0].slice(0, 60);
  if (!/\*\*Files?\.\*\*/.test(f)) problems.push(`finding ${i + 1} (${title}) names no file`);
  if (!/`[^`]+\.js:\d+/.test(f) && !/`[^`]+\.js`/.test(f)) problems.push(`finding ${i + 1} (${title}) cites no file path`);
  if (!/\*\*Recommended owner\.\*\*/.test(f)) problems.push(`finding ${i + 1} (${title}) names no owner`);
  if (!/\*\*Why/.test(f)) problems.push(`finding ${i + 1} (${title}) gives no reason`);
});
// At least one finding has to carry a concrete line number, or the document is
// too vague to act on.
const withLines = findings.filter((f) => /\.js:\d+/.test(f)).length;
console.log(`handoff: ${findings.length} findings, ${withLines} citing a line number`);
if (!withLines) problems.push("no finding cites a line number");
if (problems.length) { problems.forEach((p) => console.log("  " + p)); process.exit(1); }
console.log("HANDOFF OK");
