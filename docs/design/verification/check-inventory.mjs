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
//   node docs/design/verification/check-inventory.mjs --before-file <path> --after-file <path>
import { readFileSync, existsSync } from "node:fs";

const beforeOnly = process.argv.includes("--before");
function fileArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    console.log(`${flag} requires a path`);
    process.exit(2);
  }
  return value;
}

const beforeFile = fileArg("--before-file");
const afterFile = fileArg("--after-file");
const P = (m) => m === "before" && beforeFile
  ? beforeFile
  : m === "after" && afterFile
    ? afterFile
    : `docs/design/evidence/raw/inventory-${m}.json`;

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

// A lone Reload button is the framework error boundary, not an operator
// capability. It cannot be a parity requirement when the historical build
// failed to render the route but the current build correctly renders it.
function isErrorRecoveryOnly(route) {
  const controls = route?.controls || [];
  return controls.length === 1 &&
    controls[0]?.role === "button" &&
    controls[0]?.name === "Reload" &&
    !controls[0]?.dest &&
    controls[0]?.depth === 0;
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

const provenanceErrors = [];
const beforeProvenance = before.provenance || {};
const afterProvenance = after.provenance || {};
for (const field of ["seedDigest", "sourceRevision", "buildId"]) {
  if (!beforeProvenance[field] || !afterProvenance[field]) {
    provenanceErrors.push(`${field} missing`);
  }
}
if (!provenanceErrors.length && beforeProvenance.seedDigest !== afterProvenance.seedDigest) {
  provenanceErrors.push("seed digest differs");
}
if (!provenanceErrors.length && beforeProvenance.buildId === afterProvenance.buildId) {
  provenanceErrors.push("build identity matches");
}
if (provenanceErrors.length) {
  console.log(`provenance errors: ${provenanceErrors.length}`);
  provenanceErrors.forEach((error) => console.log("  " + error));
} else {
  console.log("provenance: same seed, distinct builds, source revisions recorded");
}

// Index the after capture by control key across the WHOLE product, because a
// control is allowed to move to another route.
const afterAll = new Map(); // key -> {route, depth}
const afterLinksByDestination = new Map(); // destination -> {route, depth}
for (const [id, r] of Object.entries(after.routes))
  for (const c of r.controls || [])
    if (!afterAll.has(c.key) || c.depth < afterAll.get(c.key).depth) {
      afterAll.set(c.key, { route: id, depth: c.depth });
      if (c.role === "link" && c.dest &&
          (!afterLinksByDestination.has(c.dest) || c.depth < afterLinksByDestination.get(c.dest).depth)) {
        afterLinksByDestination.set(c.dest, { route: id, depth: c.depth });
      }
    }

// A name-only index is only valid to prove an explicit documented relabel.
// Treating a button with the same caption as a link, or a link with a changed
// destination, as a relocation would hide a real capability regression.
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
// A volatile key is one the product does not control: the accessible name is
// built from live data or from a transient in-flight state. `namePrefix` keeps
// the excuse scoped to the one control that has it, so a whole route+role is
// not waved through.
// `namePrefix` and `namePattern` keep the excuse scoped to the controls that
// actually carry a data-built name, so a whole route+role is not waved through.
// Every constraint the entry states has to hold.
const volatileRoles = (disp.volatile || []).map((d) => ({
  key: `${d.route}|${d.role}`,
  namePrefix: d.namePrefix || null,
  namePattern: d.namePattern ? new RegExp(d.namePattern) : null,
}));
const isVolatile = (id, c) =>
  volatileRoles.some((v) =>
    v.key === `${id}|${c.role}` &&
    (!v.namePrefix || (c.name || "").startsWith(v.namePrefix)) &&
    (!v.namePattern || v.namePattern.test(c.name || "")));
// A baseline control with no accessible name cannot be matched by key, because
// the key bakes the name in. Naming one is an accessibility fix, not a loss, so
// the ledger records it per route and role and the check still demands that a
// same-role named control now exists there.
const namedRoles = new Set((disp.named || []).map((d) => `${d.route}|${d.role}`));
// `stem` is the fixed part of the caption; the rest is the row's own subject.
// `movedTo` is for the case where the per-row control also changed route: the
// baseline had one caption on a form, the product now has one per row on the
// route that owns the rows.
const parameterised = new Map((disp.parameterised || []).map(
  (d) => [`${d.route}|${d.was}`, { stem: d.stem || d.was, movedTo: d.movedTo || null }]));
const afterNamedRoles = new Set();
for (const [id, r] of Object.entries(after.routes))
  for (const c of r.controls || []) if (c.name) afterNamedRoles.add(`${id}|${c.role}`);

function accountedFor(id, c) {
  if (c.name && removedNames.has(c.name)) return "removed";
  if (isVolatile(id, c)) return "volatile";
  if (!c.name) {
    return namedRoles.has(`${id}|${c.role}`) && afterNamedRoles.has(`${id}|${c.role}`)
      ? "named" : null;
  }
  let now = renamed.get(c.name);
  if (!now) {
    const pre = renamedPrefix.find(([was]) => c.name.startsWith(was));
    if (pre) now = pre[1] + c.name.slice(pre[0].length);
  }
  // The replacement has to actually be there, or the rename is hiding a removal.
  if (now && afterByName.has(now)) return "relabelled";
  // A caption that grew a subject ("Refresh quota" -> "Refresh quota for <x>")
  // is the same action named per row. It only counts when the record says so
  // AND at least one such control now exists on that route.
  const par = parameterised.get(`${id}|${c.name}`);
  if (par && (after.routes[par.movedTo || id]?.controls || []).some(
    (x) => x.name && x.name !== par.stem && x.name.startsWith(par.stem))) {
    return "parameterised";
  }
  return null;
}

const lost = [], moved = [], tooDeep = [], errorFallbacks = [];
const onRecord = { removed: 0, relabelled: 0, volatile: 0, named: 0, parameterised: 0 };
for (const [id, r] of Object.entries(before.routes)) {
  if (isErrorRecoveryOnly(r)) {
    errorFallbacks.push(id);
    continue;
  }
  for (const c of r.controls || []) {
    const hit = afterAll.get(c.key) ||
      (c.role === "link" && c.dest ? afterLinksByDestination.get(c.dest) : null);
    if (hit) {
      if (hit.depth > 1) tooDeep.push(`${c.key} -> ${hit.route} depth ${hit.depth}`);
      else if (hit.route !== id) moved.push(`${c.name || c.role}: ${id} -> ${hit.route}`);
      continue;
    }
    const why = accountedFor(id, c);
    if (why) { onRecord[why]++; continue; }
    lost.push(`${id}: ${c.key}`);
  }
}

console.log(`relocated: ${moved.length}`);
console.log(`accounted for: ${onRecord.removed} removed on the record, ${onRecord.relabelled} relabelled, ${onRecord.named} newly named, ${onRecord.parameterised} named per row, ${onRecord.volatile} with a volatile key`);
console.log(`baseline error fallbacks ignored: ${errorFallbacks.length}`);
console.log(`deeper than one action: ${tooDeep.length}`);
console.log(`unreachable: ${lost.length}`);
tooDeep.slice(0, 20).forEach((t) => console.log("  DEEP " + t.slice(0, 150)));
lost.slice(0, 40).forEach((l) => console.log("  LOST " + l.slice(0, 150)));
if (lost.length > 40) console.log(`  ... ${lost.length - 40} more`);

if (badB.length || badA.length || provenanceErrors.length || lost.length || tooDeep.length) process.exit(1);
console.log("INVENTORY OK");
