#!/usr/bin/env bash
# The three quality gates the brief names together: no new lint findings in the
# files this branch touched, the regression authority green on the final tree,
# and the isolated smoke test passing.
set -uo pipefail
cd "$(dirname "$0")/../../.." || exit 2
D=docs/design/verification
fail=0

echo "== lint delta =="
bash "$D/check-lint-delta.sh" | tail -3 || fail=1

echo
echo "== regression authority =="
RESULTS="${VITEST_RESULTS:-/tmp/r2-vitest.json}"
if [ -f "$RESULTS" ]; then
  node tests/__baseline__/verify-no-regression.mjs "$RESULTS" | tail -4 || fail=1
else
  echo "no vitest results at $RESULTS; run: cd tests && npx vitest run --reporter=json --outputFile=$RESULTS"
  fail=1
fi

echo
echo "== registry and alias baselines =="
node tests/__baseline__/verify-providers.mjs 2>&1 | tail -2 || fail=1
node tests/__baseline__/verify-alias.mjs 2>&1 | tail -2 || fail=1
node tests/__baseline__/verify-oauth-urls.mjs 2>&1 | tail -2 || fail=1

echo
echo "== isolated smoke =="
bash "$D/check-smoke.sh" | tail -3 || fail=1

echo
[ "$fail" -eq 0 ] && echo "QUALITY OK"
exit "$fail"
