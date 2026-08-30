#!/usr/bin/env node
// Compares the capability inventory captured before the redesign with the one
// captured after. The contract is not "the same control sits on the same page":
// a control may move between routes, or sit one action deep behind a clear
// disclosure. It is "no capability became unreachable, and nothing sits more
// than one action deep".
//
// A capability may still leave the product, but only on the record:
// docs/design/evidence/capability-dispositions.json names every control that is
// gone or relabelled and the commit that did it. Anything absent and not listed
// there is a loss and fails the gate.
//
//   node docs/design/verification/check-inventory.mjs --before   before is usable
//   node docs/design/verification/check-inventory.mjs            before and after reconcile
import { readFileSync, existsSync } from "node:fs";

const beforeOnly = process.argv.includes("--before");
const P = (m) => `docs/design/evidence/raw/inventory-${m}.json`;

function load(m) {
  if (!existsSync(P(m))) { console.log(`missing ${P(m)}`); process.exit(1); }
  return JSON.parse(readFileSync(P(m), "utf8"));
}

function audit(inv, label) {
  const bad = [];
  const routes = Object.entries(inv.routes);
  for (const [id, r] of routes) {
    if (r.error) bad.push(`${id}: navigation failed (${r.error})`);
    else if (!r.controls || r.controls.length === 0) bad.push(`${id}: zero controls captured`);
  }
  console.log(`${label}: ${inv.total} controls across ${routes.length} routes`);
  return bad;
}

const before = load("before");
if (beforeOnly) {
  const bad = audit(before, "before");
  if (bad.length) { bad.forEach((b) => console.log("  " + b)); process.exit(1); }
  if (before.total < 200) { console.log("suspiciously few controls captured"); process.exit(1); }
  console.log("INVENTORY BEFORE OK");
  process.exit(0);
}

const after = load("after");
const badB = audit(before, "before");
const badA = audit(after, "after");
if (badA.length) { badA.forEach((b) => console.log("  " + b)); }

// Index the after capture by control key across the WHOLE product, because a
// control is allowed to move to another route.
const afterAll = new Map(); // key -> {route, depth}
for (const [id, r] of Object.entries(after.routes))
  for (const c of r.controls || [])
    if (!afterAll.has(c.key) || c.depth < afterAll.get(c.key).depth)
      afterAll.set(c.key, { route: id, depth: c.depth });

// A name-only index catches a control that kept its purpose but changed element
// role or destination, which is a relocation to report rather than a loss.
const afterByName = new Map();
for (const [id, r] of Object.entries(after.routes))
  for (const c of r.controls || [])
    if (c.name && !afterByName.has(c.name)) afterByName.set(c.name, { route: id, depth: c.depth });

// Dispositions: a control that is gone or relabelled on the record is accounted
// for rather than lost. A relabelled entry still has to be present under its new
// name, so a rename cannot be used to hide a removal.
const DISP = "docs/design/evidence/capability-dispositions.json";
const disp = existsSync(DISP)
  ? JSON.parse(readFileSync(DISP, "utf8"))
  : { removed: [], relabelled: [], relabelledPrefix: [], volatile: [] };
const removedNames = new Set((disp.removed || []).map((d) => d.name));
const renamed = new Map((disp.relabelled || []).map((d) => [d.was, d.now]));
const renamedPrefix = (disp.relabelledPrefix || []).map((d) => [d.was, d.now]);
const volatileRoles = new Set((disp.volatile || []).map((d) => `${d.route}|${d.role}`));

function accountedFor(id, c) {
  if (c.name && removedNames.has(c.name)) return "removed";
  if (volatileRoles.has(`${id}|${c.role}`)) return "volatile";
  if (!c.name) return null;
  let now = renamed.get(c.name);
  if (!now) {
    const pre = renamedPrefix.find(([was]) => c.name.startsWith(was));
    if (pre) now = pre[1] + c.name.slice(pre[0].length);
  }
  // The replacement has to actually be there, or the rename is hiding a removal.
  return now && afterByName.has(now) ? "relabelled" : null;
}

const lost = [], moved = [], tooDeep = [];
const onRecord = { removed: 0, relabelled: 0, volatile: 0 };
for (const [id, r] of Object.entries(before.routes)) {
  for (const c of r.controls || []) {
    const hit = afterAll.get(c.key);
    if (hit) {
      if (hit.depth > 1) tooDeep.push(`${c.key} -> ${hit.route} depth ${hit.depth}`);
      else if (hit.route !== id) moved.push(`${c.name || c.role}: ${id} -> ${hit.route}`);
      continue;
    }
    const byName = c.name && afterByName.get(c.name);
    if (byName) { moved.push(`${c.name} (role/destination changed): ${id} -> ${byName.route}`); continue; }
    const why = accountedFor(id, c);
    if (why) { onRecord[why]++; continue; }
    lost.push(`${id}: ${c.key}`);
  }
}

console.log(`relocated: ${moved.length}`);
console.log(`accounted for: ${onRecord.removed} removed on the record, ${onRecord.relabelled} relabelled, ${onRecord.volatile} with a volatile key`);
console.log(`deeper than one action: ${tooDeep.length}`);
console.log(`unreachable: ${lost.length}`);
tooDeep.slice(0, 20).forEach((t) => console.log("  DEEP " + t.slice(0, 150)));
lost.slice(0, 40).forEach((l) => console.log("  LOST " + l.slice(0, 150)));
if (lost.length > 40) console.log(`  ... ${lost.length - 40} more`);

if (badB.length || badA.length || lost.length || tooDeep.length) process.exit(1);
console.log("INVENTORY OK");
