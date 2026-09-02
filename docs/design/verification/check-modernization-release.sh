#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "$0")/../../.." && pwd)

verify_vitest_report() {
  local report_path=$1
  local report_root=${2:-$repo}
  local failure
  local known_count
  local now_count=0
  local vitest_status=${3:-0}
  local -a regressions=()

  case "$vitest_status" in
    ''|*[!0-9]*)
      echo "Invalid Vitest exit status: $vitest_status" >&2
      return 2
      ;;
  esac
  if ! test -s "$report_path"; then
    echo "Vitest report is missing or empty: $report_path" >&2
    return 2
  fi
  if ! jq -e '
    type == "object" and
    (.testResults | type == "array" and length > 0) and
    all(.testResults[];
      (.name | type == "string" and length > 0) and
      (.assertionResults | type == "array") and
      all(.assertionResults[];
        (.fullName | type == "string" and length > 0) and
        (.status as $status |
          ["passed", "failed", "skipped", "pending", "todo", "disabled"] |
          index($status) != null)
      )
    ) and
    ([.testResults[].assertionResults[]] | length > 0)
  ' "$report_path" >/dev/null 2>&1; then
    echo "Vitest report is invalid or contains no test results: $report_path" >&2
    return 2
  fi

  while IFS= read -r failure; do
    [ -n "$failure" ] || continue
    now_count=$((now_count + 1))
    if ! grep -Fxq -- "$failure" "$report_root/tests/__baseline__/known-fails.txt"; then
      regressions+=("$failure")
    fi
  done < <(jq -r '
    .testResults[] |
    .name as $name |
    .assertionResults[] |
    select(.status == "failed") |
    ($name | if contains("/tests/") then split("/tests/")[1]
             elif contains("/app/") then split("/app/")[1]
             else . end) as $relative |
    "tests/\($relative) :: \(.fullName)"
  ' "$report_path")

  if [ "${#regressions[@]}" -gt 0 ]; then
    echo "REGRESSION: ${#regressions[@]} new test failure(s)" >&2
    printf '  - %s\n' "${regressions[@]}" >&2
    return 1
  fi
  known_count=$(wc -l < "$report_root/tests/__baseline__/known-fails.txt")
  echo "No regression. (now fails=$now_count, baseline known=$known_count, all known)"
  # Vitest exits 1 for an ordinary assertion failure. Once every reported
  # assertion is in the explicit baseline, that status is expected. A nonzero
  # result with no reported failed assertion is a runner failure, not a known
  # test failure, so it remains a hard stop.
  if [ "$vitest_status" -ne 0 ] && { [ "$vitest_status" -ne 1 ] || [ "$now_count" -eq 0 ]; }; then
    echo "Vitest exited nonzero with status $vitest_status" >&2
    return 1
  fi
}

if [ "${1:-}" = "--verify-vitest-report" ]; then
  if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
    echo "usage: $0 --verify-vitest-report REPORT [VITEST_STATUS]" >&2
    exit 2
  fi
  verify_vitest_report "$2" "$repo" "${3:-0}"
  exit $?
fi

scratch=$(mktemp -d "${TMPDIR:-/tmp}/tokenproxy-release.XXXXXX")
worktree="$scratch/worktree"
report="$worktree/vitest-results.json"

cleanup() {
  if test -d "$worktree"; then
    git -C "$repo" worktree remove --force "$worktree" || true
  fi
  rm -rf "$scratch"
}
trap cleanup EXIT

# Preserve Git history because regression tests prove repair commits are
# ancestors. Then overlay the current shared tree without touching its .next.
git -C "$repo" worktree add --detach "$worktree" HEAD
rsync -a \
  --exclude=.git \
  --exclude=.claude \
  --exclude=.next \
  --exclude=node_modules \
  --exclude=tests/node_modules \
  --exclude=.env \
  "$repo/" "$worktree/"
test ! -e "$worktree/.next"

cd "$worktree"
export DATA_DIR="$worktree/.verification-data"
mise x node@24.15.0 -- npm install --no-audit --no-fund
(
  cd tests
  mise x node@24.15.0 -- npm install --no-audit --no-fund
)
JWT_SECRET=ci-build-only-not-a-real-secret-000000000000 \
API_KEY_SECRET=ci-build-only-not-a-real-secret-111111111111 \
MACHINE_ID_SALT=ci-build-only-not-a-real-salt-2222 \
  mise x node@24.15.0 -- npm run build

vitest_status=0
(
  cd tests
  unset XDG_CONFIG_HOME
  mise x node@24.15.0 -- npx vitest run \
    --testTimeout=30000 \
    --hookTimeout=30000 \
    --reporter=default \
    --reporter=json \
    --outputFile.json="$report"
) || vitest_status=$?
verify_vitest_report "$report" "$worktree" "$vitest_status"
mise x node@24.15.0 -- node tests/__baseline__/verify-no-regression.mjs "$report"
mise x node@24.15.0 -- node tests/__baseline__/verify-providers.mjs
mise x node@24.15.0 -- node tests/__baseline__/verify-alias.mjs
mise x node@24.15.0 -- node tests/__baseline__/verify-oauth-urls.mjs

# Committed evidence is published with the repository. A credential, a provider
# identity, or a local endpoint that reaches a committed file is out, and no
# amount of later redaction takes it back. The redaction check therefore runs
# as a release gate rather than as something an operator remembers to run.
# Every text evidence file that ships, not only the raw captures. Checking one
# directory left the written reports, the locale audit and the performance
# record unchecked, and those are the files a reader actually opens.
readarray -t evidence_files < <(
  find docs/design/evidence -type f \( -name '*.json' -o -name '*.md' \) | sort
)
test "${#evidence_files[@]}" -gt 0
mise x node@24.15.0 -- node docs/design/verification/redactEvidence.mjs --check \
  "${evidence_files[@]}"

echo "modernization release gates ok"
