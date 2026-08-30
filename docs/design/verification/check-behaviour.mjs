#!/usr/bin/env node
// Round 2 behavioural fingerprint. Round 1 compared each changed file against
// its own past, which forbids exactly the restructuring round 2 needs: moving a
// control from one component to another shows as a diff on both sides.
//
// This builds ONE multiset over the whole source tree and compares it against
// the merge base. Entries carry no filename, so relocating a handler is legal;
// adding, dropping or altering one is not.
//
// It also asserts the read-only paths are untouched, which is a stronger and
// cheaper guarantee than fingerprinting them.
//
//   node .unlazy/r2/check-behaviour.mjs            compare HEAD tree to merge base
//   node .unlazy/r2/check-behaviour.mjs --verbose  list every differing entry

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const verbose = process.argv.includes("--verbose");
const ref = process.env.BASE_REF || "master";

const git = (args, opts = {}) =>
  spawnSync("git", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, ...opts });

const mb = git(["merge-base", ref, "HEAD"]);
const base = mb.status === 0 && mb.stdout.trim() ? mb.stdout.trim() : ref;

// ---------- 1. read-only paths must be untouched ----------

const READ_ONLY = [
  "open-sse/", "src/sse/", "src/lib/", "src/app/api/", "src/models/",
  "src/store/", "src/mitm/", "tests/", "scripts/", "PLAN.md", "GATES.md",
];
// Committed changes AND the working tree. The three-dot form alone compares
// committed trees only, so an uncommitted edit to a read-only path would pass.
const changedCommitted = (git(["diff", "--name-only", `${base}...HEAD`]).stdout || "")
  .split("\n").filter(Boolean);
const changedWorktree = (git(["status", "--porcelain"]).stdout || "")
  .split("\n").filter(Boolean)
  .map((l) => l.slice(3).trim())
  .flatMap((l) => (l.includes(" -> ") ? l.split(" -> ") : [l]))
  .map((f) => f.replace(/^"|"$/g, ""));
const changedAll = [...new Set([...changedCommitted, ...changedWorktree])];
const trespass = changedAll.filter((f) => READ_ONLY.some((p) =>
  p.endsWith("/") ? f.startsWith(p) : f === p));

// ---------- 2. repo-wide behavioural multiset ----------

// Any file that can carry behaviour, wherever it lives in the source tree.
const SOURCE_RE = /^(src|open-sse)\/.*\.jsx?$/;

function listAt(rev) {
  return (git(["ls-tree", "-r", "--name-only", rev]).stdout || "")
    .split("\n").filter((f) => SOURCE_RE.test(f));
}

// One `git cat-file --batch` for every base blob, rather than one `git show`
// per file. On this tree that is ~700 files: a single process, not 700.
function readBaseBlobs(paths) {
  const input = paths.map((p) => `${base}:${p}`).join("\n") + "\n";
  const res = spawnSync("git", ["cat-file", "--batch"], {
    input, maxBuffer: 1024 * 1024 * 1024,
  });
  const buf = res.stdout;
  const out = new Map();
  let off = 0, i = 0;
  while (off < buf.length && i < paths.length) {
    let nl = buf.indexOf(0x0a, off);
    if (nl === -1) break;
    const header = buf.slice(off, nl).toString("utf8");
    off = nl + 1;
    if (/ missing$/.test(header) || /^[^ ]+ missing/.test(header)) { i++; continue; }
    const parts = header.split(" ");
    const size = Number(parts[2]);
    if (!Number.isFinite(size)) break;
    out.set(paths[i], buf.slice(off, off + size).toString("utf8"));
    off += size + 1; // content plus its trailing newline
    i++;
  }
  return out;
}

function balanced(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return text.slice(openIdx + 1, i); }
  }
  return text.slice(openIdx + 1);
}

const norm = (s) => s.replace(/\s+/g, " ").trim();

// The behavioural surface named by the contract. No filename is included, so a
// control that moves between components leaves the multiset unchanged.
function fingerprint(text) {
  const out = [];
  for (const m of text.matchAll(/\buse[A-Z]\w*\s*\(/g))
    out.push("hook:" + m[0].replace(/\s+/g, ""));
  for (const m of text.matchAll(/\b(fetch|axios(?:\.\w+)?)\s*\(\s*([`'"][^`'"]*[`'"])?/g))
    out.push("call:" + m[1] + ":" + (m[2] || "?"));
  for (const m of text.matchAll(/[`'"](\/(?:api|v1)\/[^`'"]*)[`'"]/g))
    out.push("path:" + m[1]);
  for (const m of text.matchAll(/\bset[A-Z]\w*\s*\(/g))
    out.push("setter:" + m[0].replace(/\s+/g, ""));
  for (const m of text.matchAll(/from\s+["'](@\/(?:lib|store|models|sse|shared\/utils|shared\/hooks)[^"']*)["']/g)) {
    // `cn` is a pure class-name joiner (filter, join, collapse whitespace, trim:
    // no state, no I/O, no side effect), so importing it is presentation, not
    // behaviour. It is the single exclusion; every other module under
    // shared/utils stays in the signal because some of them do carry behaviour.
    if (m[1] === "@/shared/utils/cn") continue;
    out.push("import:" + m[1]);
  }
  for (const m of text.matchAll(/\brouter\.(push|replace|back|refresh)\s*\(\s*([`'"][^`'"]*[`'"])?/g))
    out.push("nav:" + m[1] + ":" + (m[2] || "?"));
  for (const m of text.matchAll(/\bon[A-Z]\w*\s*=\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    out.push("handler:" + m[0].split("=")[0].trim() + ":" + norm(balanced(text, open)));
  }
  return out;
}

function multiset(entries) {
  const m = new Map();
  for (const e of entries) m.set(e, (m.get(e) || 0) + 1);
  return m;
}

const basePaths = listAt(base);
// `ls-files` rather than `ls-tree HEAD`, so an uncommitted edit or a rename is
// caught rather than silently read from HEAD. `--others --exclude-standard`
// includes new files that are not yet staged: without it a brand new component
// full of fetch calls would be invisible to this checker.
const headPaths = (git(["ls-files", "--cached", "--others", "--exclude-standard"]).stdout || "")
  .split("\n").filter((f) => SOURCE_RE.test(f));
const baseBlobs = readBaseBlobs(basePaths);

const baseEntries = [];
for (const p of basePaths) {
  const t = baseBlobs.get(p);
  if (t !== undefined) baseEntries.push(...fingerprint(t));
}
const headEntries = [];
for (const p of headPaths) {
  // Read the working copy, not the blob, so uncommitted edits are in scope.
  headEntries.push(...fingerprint(readFileSync(p, "utf8")));
}

const A = multiset(baseEntries), B = multiset(headEntries);
const diffs = [];
for (const k of new Set([...A.keys(), ...B.keys()])) {
  const x = A.get(k) || 0, y = B.get(k) || 0;
  if (x !== y) diffs.push({ k, x, y });
}
diffs.sort((a, b) => Math.abs(b.y - b.x) - Math.abs(a.y - a.x));

console.log(`base ${base}`);
console.log(`source files: ${basePaths.length} at base, ${headPaths.length} at HEAD`);
console.log(`behavioural entries: ${baseEntries.length} at base, ${headEntries.length} at HEAD`);
console.log(`distinct entries: ${A.size} at base, ${B.size} at HEAD`);

let failed = false;
if (trespass.length) {
  failed = true;
  console.log(`READ_ONLY_TRESPASS=${trespass.length}`);
  trespass.forEach((f) => console.log("  " + f));
}
if (diffs.length) {
  failed = true;
  console.log(`BEHAVIOUR_DIFFS=${diffs.length}`);
  (verbose ? diffs : diffs.slice(0, 40)).forEach((d) =>
    console.log(`  ${d.x} -> ${d.y}  ${d.k.slice(0, 160)}`));
  if (!verbose && diffs.length > 40)
    console.log(`  ... ${diffs.length - 40} more (rerun with --verbose)`);
}
if (failed) process.exit(1);
console.log("BEHAVIOUR OK");
