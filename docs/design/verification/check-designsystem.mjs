#!/usr/bin/env node
// The design system document exists, covers every area the brief names, and
// its contrast table is not stale: every declared pair is re-measured against
// the live token values and must meet its requirement.
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const DOC = "docs/design/design-system.md";
const problems = [];
if (!existsSync(DOC)) { console.log(`missing ${DOC}`); process.exit(1); }
const t = readFileSync(DOC, "utf8");

const AREAS = [
  ["colour tokens", /## 1\. Foundation/],
  ["typography", /## 2\. Typography/],
  ["grid, spacing, density", /## 3\. Grid, spacing and density/],
  ["structure and elevation and radius", /## 4\. Structure instead of card chrome/],
  ["motion", /## 5\. Motion/],
  ["focus", /## 6\. Focus and hit targets/],
  ["iconography", /## 7\. Iconography/],
  ["data visualisation grammar", /## 8\. Data visualisation grammar/],
  ["asymmetry and alignment", /## 9\. Asymmetry and alignment/],
  ["phone recomposition", /## 10\. How desktop recomposes on phones/],
  ["localisation", /## 11\. Localisation as a layout constraint/],
  ["measured contrast", /## 12\. Measured contrast/],
];
for (const [name, re] of AREAS) if (!re.test(t)) problems.push(`document does not cover ${name}`);

// The table must be current, so re-measure rather than trust the prose.
const res = spawnSync("node", ["docs/design/verification/contrast.mjs", "--json"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
let measured = null;
try { measured = JSON.parse(res.stdout); } catch { problems.push("could not measure contrast"); }
if (measured) {
  console.log(`measured ${measured.rows.length} pairs, ${measured.failures} below requirement`);
  if (measured.failures) {
    problems.push(`${measured.failures} colour pairs below requirement`);
    measured.rows.filter((r) => !r.pass).slice(0, 12)
      .forEach((r) => problems.push(`  ${r.theme} ${r.fg} on ${r.bg}: ${r.ratio} < ${r.min}`));
  }
  // Every measured pair has to appear in the document's table.
  for (const r of measured.rows) {
    if (!t.includes(`\`${r.fg}\``) || !t.includes(`\`${r.bg}\``))
      problems.push(`pair not documented: ${r.fg} on ${r.bg}`);
  }
}
if (problems.length) { problems.slice(0, 20).forEach((p) => console.log("  " + p)); process.exit(1); }
console.log("DESIGNSYSTEM OK");
