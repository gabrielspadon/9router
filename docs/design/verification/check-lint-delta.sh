#!/usr/bin/env bash
# eslint is already red on master, so a total count proves nothing. The gate is
# that this source tree adds no NEW finding to the files it touches.
#
# Compares, per file and per rule, the findings on the branch against the
# findings on the same files at the merge base. The base is linted in a
# throwaway worktree with node_modules symlinked, so the same config and the
# same plugin versions are used on both sides.
set -uo pipefail

validate_eslint_report() {
  if ! jq -e 'type == "array" and length > 0' "$1" >/dev/null 2>&1; then
    echo "ESLint report is invalid or contains no file results: $1" >&2
    return 2
  fi
}

run_eslint() {
  local root=$1
  local output=$2
  shift 2
  local status

  (cd "$root" && "${ESLINT_NPX:-npx}" eslint --no-error-on-unmatched-pattern -f json "$@" > "$output" 2>/dev/null)
  status=$?
  if [ "$status" -gt 1 ]; then
    echo "ESLint execution failed with status $status" >&2
    return 2
  fi
  validate_eslint_report "$output"
}

if [ "${1:-}" = "--run-eslint" ]; then
  [ "$#" -ge 4 ] || { echo "usage: $0 --run-eslint ROOT OUTPUT FILE..." >&2; exit 2; }
  shift
  run_eslint "$@"
  exit $?
fi

cd "$(dirname "$0")/../../.." || exit 2

BASE_REF="${BASE_REF:-master}"
BASE="$(git merge-base "$BASE_REF" HEAD)"
WT=/tmp/tokenproxy-lintbase
OUT=/tmp/lint-delta

mkdir -p "$OUT"
mapfile -t FILES < <(
  {
    git diff --name-only "$BASE...HEAD"
    git diff --name-only
    git ls-files --others --exclude-standard
  } | sort -u | grep -E '\.(js|jsx|mjs)$' || true
)
if [ "${#FILES[@]}" -eq 0 ]; then echo "no lintable files changed"; echo "LINT DELTA OK"; exit 0; fi
echo "changed lintable files: ${#FILES[@]}"

# Current side.
run_eslint "$PWD" "$OUT/head.json" "${FILES[@]}" || exit $?

# Base side, in a detached worktree so the base content is linted with this
# tree's config and dependencies.
git worktree remove --force "$WT" >/dev/null 2>&1
git worktree add --detach "$WT" "$BASE" >/dev/null 2>&1 || { echo "could not create base worktree"; exit 2; }
ln -sfn "$PWD/node_modules" "$WT/node_modules"
cp eslint.config.mjs "$WT/eslint.config.mjs" 2>/dev/null
BASE_FILES=()
for f in "${FILES[@]}"; do [ -f "$WT/$f" ] && BASE_FILES+=("$f"); done
if [ "${#BASE_FILES[@]}" -gt 0 ]; then
  lint_status=0
  run_eslint "$WT" "$OUT/base.json" "${BASE_FILES[@]}" || lint_status=$?
  if [ "$lint_status" -ne 0 ]; then
    git worktree remove --force "$WT" >/dev/null 2>&1
    exit "$lint_status"
  fi
else
  echo '[]' > "$OUT/base.json"
fi
git worktree remove --force "$WT" >/dev/null 2>&1

node - "$OUT/base.json" "$OUT/head.json" "$WT" "$PWD" <<'NODE'
const fs = require("node:fs");
const [, , baseP, headP, baseRoot = "", headRoot = ""] = process.argv;
const load = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
// Key by file and rule, not by line: a finding that only moved down the file
// because markup above it grew is not a new finding.
const tally = (rs) => {
  const m = new Map();
  for (const r of rs) {      // Normalise both sides to a repo-relative path. An allowlist of top-level
      // directories silently misses any other one (open-sse was reported as a
      // new finding purely because its path never matched), so strip the run
      // root instead, which is passed in as the last two argv entries.
      const f = r.filePath.replace(baseRoot, "").replace(headRoot, "").replace(/^\/+/, "");
    for (const msg of r.messages || []) {
      const k = `${f}|${msg.ruleId || "syntax"}`;
      m.set(k, (m.get(k) || 0) + 1);
    }
  }
  return m;
};
const base = tally(load(baseP)), head = tally(load(headP));
const grew = [];
for (const [k, n] of head) {
  const was = base.get(k) || 0;
  if (n > was) grew.push(`${k}  ${was} -> ${n}`);
}
const baseTotal = [...base.values()].reduce((a, b) => a + b, 0);
const headTotal = [...head.values()].reduce((a, b) => a + b, 0);
console.log(`findings in changed files: ${baseTotal} at base, ${headTotal} on branch`);
if (grew.length) {
  console.log(`NEW_LINT_FINDINGS=${grew.length}`);
  grew.slice(0, 25).forEach((g) => console.log("  " + g));
  process.exit(1);
}
console.log("LINT DELTA OK");
NODE
