#!/usr/bin/env node
// Idempotent upstream sync + validator for the 9Router fork tracking files.
// Reads open PRs/issues from decolua/9router (read-only, via gh api), appends
// unknown IDs to the open tracking files. Never rebuilds, never demotes a
// closed ID back to open. --check validates state and fails on inconsistency.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const UPSTREAM = 'decolua/9router';

const files = {
  pr: { open: join(ROOT, 'tracking/upstream-prs-open.md'), closed: join(ROOT, 'tracking/upstream-prs-closed.md') },
  issue: { open: join(ROOT, 'tracking/upstream-issues-open.md'), closed: join(ROOT, 'tracking/upstream-issues-closed.md') },
};

function gh(args) {
  return execFileSync('gh', ['api', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 });
}

function fetchOpen(kind) {
  const path = kind === 'pr' ? 'pulls' : 'issues';
  const out = gh([`repos/${UPSTREAM}/${path}?state=open&per_page=100`, '--paginate', '--jq',
    kind === 'pr'
      ? '.[] | [.number, .title] | @tsv'
      : '.[] | select(.pull_request == null) | [.number, .title] | @tsv']);
  return out.split('\n').filter(Boolean).map(l => {
    const [num, ...rest] = l.split('\t');
    return { number: Number(num), title: rest.join('\t') };
  });
}

function parseIds(file) {
  const text = readFileSync(file, 'utf8');
  const ids = new Set();
  const re = /^## (PR|Issue) #(\d+)/gm;
  let m;
  while ((m = re.exec(text))) ids.add(`# ${m[2]}`);
  return ids;
}

function validate() {
  const problems = [];
  for (const [kind, paths] of Object.entries(files)) {
    const tag = kind === 'pr' ? 'PR' : 'Issue';
    const open = parseIds(paths.open);
    const closed = parseIds(paths.closed);
    for (const id of open) if (closed.has(id)) problems.push(`${tag} ${id} appears in BOTH open and closed files`);
    // intra-file duplicates
    const text = readFileSync(paths.open, 'utf8');
    const seen = new Map();
    const re = /^## (?:PR|Issue) #(\d+)/gm;
    let m;
    while ((m = re.exec(text))) seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
    for (const [id, n] of seen) if (n > 1) problems.push(`${tag} #${id} appears ${n} times in the open file`);
  }
  return problems;
}

function appendNew(kind, items) {
  const paths = files[kind];
  const open = parseIds(paths.open);
  const closed = parseIds(paths.closed);
  const tag = kind === 'pr' ? 'PR' : 'Issue';
  const base = kind === 'pr' ? 'pull' : 'issues';
  let appended = 0;
  let buf = '';
  for (const it of items) {
    const id = `# ${it.number}`;
    if (open.has(id) || closed.has(id)) continue;
    buf += `\n## ${tag} #${it.number} — ${it.title}\n\n- url: https://github.com/${UPSTREAM}/${base}/${it.number}\n- upstream-state: open (discovered ${new Date().toISOString().slice(0, 10)})\n- local-status: queued\n- branch: \n- local-ref: \n- disposition: \n- validation: \n- notes: \n\n`;
    appended++;
  }
  if (buf) writeFileSync(paths.open, readFileSync(paths.open, 'utf8').replace(/\n*$/, '\n') + buf);
  return appended;
}

const checkOnly = process.argv.includes('--check');

const problems = validate();
if (problems.length) {
  console.error('TRACKING VALIDATION FAILED:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

if (checkOnly) {
  console.log('tracking state OK');
  process.exit(0);
}

for (const kind of ['pr', 'issue']) {
  const items = fetchOpen(kind);
  const n = appendNew(kind, items);
  console.log(`${kind}: upstream has ${items.length} open, appended ${n} new entries`);
}
