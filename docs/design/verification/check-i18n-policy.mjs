#!/usr/bin/env node
// One documented maintenance policy for the translated READMEs, and the load
// bearing items in each translated page are present.
import { existsSync, readFileSync } from "node:fs";
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
console.log(`translations linked: ${uniq.length}, present: ${checked}`);
if (problems.length) { problems.slice(0, 15).forEach((p) => console.log("  " + p)); process.exit(1); }
console.log("I18N POLICY OK");
