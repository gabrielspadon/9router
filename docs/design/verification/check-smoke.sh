#!/usr/bin/env bash
# The isolated instance, on its own DATA_DIR and its own port, passes the
# repository's own smoke test. Production on 20128 is never touched.
set -uo pipefail
cd "$(dirname "$0")/../../.." || exit 2
PORT="${R2_PORT:-20135}"
if ! curl -sq -o /dev/null --max-time 5 "http://127.0.0.1:${PORT}/dashboard"; then
  echo "no isolated instance on ${PORT}; start it with docs/design/verification/instance.sh up"
  exit 1
fi
echo "isolated instance responding on ${PORT}"
SMOKE_BASE="http://127.0.0.1:${PORT}" SMOKE_PASSWORD="${SMOKE_PASSWORD:-123456}" \
  node scripts/smoke-test.mjs 2>&1 | tail -25
rc=${PIPESTATUS[0]}
[ "$rc" -eq 0 ] && echo "SMOKE OK"
exit "$rc"
