#!/usr/bin/env node
// Conformance check for the FROZEN admin ABI (docs/reconciliation/admin-abi.json).
//
// This is a STATIC check against the route tree, deliberately, because the
// alternative — booting the app and probing it — proves only that the running
// build matches itself. It reads the contract document, derives the Next.js
// App Router file every documented operation must resolve to, and asserts the
// handler is exported. It never imports the contract's own vocabulary from the
// implementation: the required path set comes from the document, so deleting a
// route makes the check fail rather than shrinking what it checks.
//
// Exit 0 and print ABI_CONFORMS only when every documented operation has a
// handler AND every state-changing operation is covered by the auth policy the
// document declares. Anything else prints the specific violation and exits 1.

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ABI = resolve(ROOT, "docs/reconciliation/admin-abi.json");
const GUARD = resolve(ROOT, "src/dashboardGuard.js");

const fail = [];
const note = (m) => fail.push(m);

if (!existsSync(ABI)) {
  console.log(`ABI_MISSING ${ABI}`);
  process.exit(2);
}
const abi = JSON.parse(readFileSync(ABI, "utf8"));
const paths = abi.paths ?? {};
const documented = Object.entries(paths).flatMap(([p, ops]) =>
  Object.keys(ops)
    .filter((m) => ["get", "post", "put", "patch", "delete"].includes(m))
    .map((m) => ({ path: p, method: m.toUpperCase() })),
);

if (documented.length === 0) {
  console.log("ABI_EMPTY no documented operations");
  process.exit(2);
}

// "/api/admin/drain/{connectionId}" -> "src/app/api/admin/drain/[connectionId]/route.js"
const routeFileFor = (p) =>
  resolve(ROOT, "src/app" + p.replace(/\{([^}]+)\}/g, "[$1]") + "/route.js");

// Group by file so one read serves every method on that path.
const byFile = new Map();
for (const op of documented) {
  const f = routeFileFor(op.path);
  if (!byFile.has(f)) byFile.set(f, []);
  byFile.get(f).push(op);
}

let present = 0;
for (const [file, ops] of byFile) {
  if (!existsSync(file)) {
    for (const op of ops) note(`MISSING_ROUTE ${op.method} ${op.path} -> ${file.slice(ROOT.length + 1)}`);
    continue;
  }
  const src = readFileSync(file, "utf8");
  for (const op of ops) {
    // An App Router handler is a named export of the HTTP method. Accept the
    // `export async function GET` and `export const GET =` spellings, and
    // nothing else: a method served by a catch-all default export is not the
    // contract this document froze.
    const re = new RegExp(`export\\s+(?:async\\s+function|const|function)\\s+${op.method}\\b`);
    if (re.test(src)) present += 1;
    else note(`NO_HANDLER ${op.method} ${op.path} in ${file.slice(ROOT.length + 1)}`);
  }
}

// Every state-changing operation the document names must be inside the auth
// policy it declares. The document lists them explicitly in adminMutationPolicy;
// cross-check that list against the paths, so a new mutating endpoint added to
// `paths` without being added to the policy is caught rather than assumed safe.
const policy = abi.adminMutationPolicy?.statement ?? "";
const mutating = documented.filter((o) => o.method !== "GET");
for (const op of mutating) {
  const needle = `${op.method} ${op.path}`;
  if (!policy.includes(needle)) note(`UNPOLICED ${needle} is state-changing but adminMutationPolicy does not name it`);
}
if (mutating.length === 0) note("NO_MUTATING_OPS documented, which contradicts an admin ABI");

// The guard must actually protect the namespace. A contract that says
// "operator class" while the middleware treats /api/admin as public is a
// contract about nothing.
if (existsSync(GUARD)) {
  const g = readFileSync(GUARD, "utf8");
  if (!/["'`]\/api\/admin/.test(g)) note("GUARD_SILENT src/dashboardGuard.js never mentions /api/admin");
  const publicList = g.match(/PUBLIC_API_PATHS\s*=\s*\[[^\]]*\]/s)?.[0] ?? "";
  const publicPrefixes = g.match(/PUBLIC_PREFIXES\s*=\s*\[[^\]]*\]/s)?.[0] ?? "";
  if (/\/api\/admin/.test(publicList) || /\/api\/admin/.test(publicPrefixes))
    note("GUARD_PUBLIC /api/admin appears in a PUBLIC list; the ABI declares an operator class");
} else {
  note(`GUARD_MISSING ${GUARD.slice(ROOT.length + 1)}`);
}

if (fail.length) {
  for (const m of fail) console.log(m);
  console.log(`ABI_NONCONFORMING ${present}/${documented.length} handlers, ${fail.length} violations`);
  process.exit(1);
}
console.log(`ABI_CONFORMS ${present}/${documented.length} operations, ${mutating.length} state-changing`);
