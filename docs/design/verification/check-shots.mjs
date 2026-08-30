#!/usr/bin/env node
// Screenshot coverage: every audited route, in both themes, at every viewport,
// plus the 200 percent zoom view. Checks the capture is complete rather than
// that it looks right; looking right is the reviewer's job on the renders.
import { existsSync, readFileSync, readdirSync } from "node:fs";
const beforeOnly = process.argv.includes("--before");
const modes = beforeOnly ? ["before"] : ["before", "after"];
const TAGS = ["desktop", "laptop", "phone", "zoom200"];
const problems = [];
let grand = 0;

for (const mode of modes) {
  const jsonPath = `.unlazy/r2/evidence/${mode}.json`;
  const dir = `.unlazy/r2/evidence/${mode}`;
  if (!existsSync(jsonPath)) { problems.push(`missing ${jsonPath}`); continue; }
  if (!existsSync(dir)) { problems.push(`missing ${dir}`); continue; }
  const data = JSON.parse(readFileSync(jsonPath, "utf8"));
  const routes = [...new Set(Object.keys(data.routes).map((k) => k.split("|")[0]))];
  const shots = readdirSync(dir).filter((f) => f.endsWith(".png"));
  grand += shots.length;

  for (const r of routes) {
    for (const theme of ["light", "dark"]) {
      for (const tag of TAGS) {
        // zoom200 is captured once, in dark, by design.
        if (tag === "zoom200" && theme === "light") continue;
        if (!shots.includes(`${r}--${theme}--${tag}.png`))
          problems.push(`${mode}: missing ${r}--${theme}--${tag}.png`);
      }
    }
  }
  const navErrors = Object.entries(data.routes).filter(([, v]) => v.navError);
  for (const [k, v] of navErrors) problems.push(`${mode}: ${k} navigation failed (${String(v.navError).slice(0, 80)})`);
  console.log(`${mode}: ${routes.length} routes, ${Object.keys(data.routes).length} views, ${shots.length} screenshots`);
}

console.log(`total screenshots: ${grand}`);
if (problems.length) {
  problems.slice(0, 25).forEach((p) => console.log("  " + p));
  if (problems.length > 25) console.log(`  ... ${problems.length - 25} more`);
  process.exit(1);
}
console.log(beforeOnly ? "SHOTS BEFORE OK" : "SHOTS OK");
