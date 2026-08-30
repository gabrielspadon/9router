#!/usr/bin/env node
// One documented maintenance policy for README languages, and the load bearing
// items in every translated page the English README offers. The policy this
// fork ships is English only, so the checker also asserts the repository does
// not carry a translated page the README never mentions: policy and tree
// cannot disagree silently.
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const POLICY = "docs/design/translation-policy.md";
const problems = [];
if (!existsSync(POLICY)) { console.log(`missing ${POLICY}`); process.exit(1); }
const readme = readFileSync("README.md", "utf8");
if (!readme.includes("design/translation-policy.md")) problems.push("README does not link the translation policy");

// Every translated page the README offers must exist and carry the two items
// most likely to go stale: the install command and the default port.
const links = [...readme.matchAll(/\]\(\.?\/?((?:i18n\/)?README\.[\w-]+\.md)\)/g)].map((m) => m[1]);
const uniq = [...new Set(links)];
let checked = 0;
for (const f of uniq) {
  if (!existsSync(f)) { problems.push(`linked translation missing: ${f}`); continue; }
  checked++;
  const t = readFileSync(f, "utf8");
  if (!/npm install -g 9router/.test(t)) problems.push(`${f} does not carry the install command`);
  if (!/20128/.test(t)) problems.push(`${f} does not carry the default port`);
}
// A translated page tracked in the repository but not linked from the English
// README is exactly the page that goes stale unseen.
let tracked = [];
try {
  tracked = execFileSync("git", ["ls-files", "README.*.md", "i18n/README.*.md"], { encoding: "utf8" })
    .split("\n").filter(Boolean);
} catch { /* not a git checkout; the linked-page checks above still stand */ }
for (const f of tracked)
  if (!uniq.includes(f)) problems.push(`translated page shipped but not linked from README: ${f}`);

console.log(`translations linked: ${uniq.length}, present: ${checked}, shipped: ${tracked.length}`);
if (problems.length) { problems.slice(0, 15).forEach((p) => console.log("  " + p)); process.exit(1); }
console.log("I18N POLICY OK");
