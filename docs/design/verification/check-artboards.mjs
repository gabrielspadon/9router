#!/usr/bin/env node
// The three hypotheses exist as working artboards, render in both themes and
// in all three states, and a written judgment scores them and names a winner.
import { existsSync, readFileSync, readdirSync } from "node:fs";
const judgment = process.argv.includes("--judgment");
const DIR = "docs/design/artboards";
const BOARDS = ["a1-signal-room", "a2-route-atlas", "a3-switchboard"];
const STATES = ["stateA", "stateB", "stateC"];
const THEMES = ["dark", "light"];
const problems = [];

if (!judgment) {
  for (const b of BOARDS) {
    if (!existsSync(`${DIR}/${b}.html`)) problems.push(`missing source ${b}.html`);
    for (const t of THEMES) for (const s of STATES) {
      const p = `${DIR}/render/${b}--${t}--${s}.png`;
      if (!existsSync(p)) problems.push(`missing render ${p}`);
    }
  }
  const renders = existsSync(`${DIR}/render`) ? readdirSync(`${DIR}/render`).filter((f) => f.endsWith(".png")) : [];
  console.log(`artboards: ${BOARDS.length} sources, ${renders.length} renders`);
  if (renders.length !== BOARDS.length * THEMES.length * STATES.length)
    problems.push(`expected ${BOARDS.length * THEMES.length * STATES.length} renders, found ${renders.length}`);
  if (problems.length) { problems.forEach((p) => console.log("  " + p)); process.exit(1); }
  console.log("ARTBOARDS OK");
  process.exit(0);
}

const doc = "docs/design/r2-direction.md";
if (!existsSync(doc)) { console.log(`missing ${doc}`); process.exit(1); }
const t = readFileSync(doc, "utf8");
// A judgment must score every hypothesis on every named criterion, and pick one.
const CRITERIA = ["four product jobs", "Action visibility", "unhealthy provider",
  "fallback order", "Keyboard path", "Small-screen resilience",
  "Localisation resilience", "behaviour contract"];
for (const c of CRITERIA) if (!t.includes(c)) problems.push(`criterion not scored: ${c}`);
for (const b of ["Signal Room", "Route Atlas", "Switchboard"])
  if (!t.includes(b)) problems.push(`hypothesis not discussed: ${b}`);
if (!/## Selected direction/.test(t)) problems.push("no selected direction");
if (!/## Signature elements/.test(t)) problems.push("no signature elements");
const sig = (t.match(/## Signature elements[\s\S]*?(?=\n## |$)/) || [""])[0];
const sigCount = (sig.match(/^\d+\. \*\*/gm) || []).length;
if (sigCount < 3) problems.push(`only ${sigCount} signature elements, need at least 3`);
const critique = "docs/design/r2-critique.md";
if (!existsSync(critique)) problems.push(`missing ${critique}`);
console.log(`judgment: ${CRITERIA.length} criteria, 3 hypotheses, ${sigCount} signature elements`);
if (problems.length) { problems.forEach((p) => console.log("  " + p)); process.exit(1); }
console.log("JUDGMENT OK");
