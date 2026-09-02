#!/usr/bin/env bash
# The isolated instance, on its own DATA_DIR and its own port, passes the
# repository's own smoke test. Production on 20128 is never touched.
set -uo pipefail
cd "$(dirname "$0")/../../.." || exit 2
PORT="${TP_PORT:-20135}"
INSTANCE="${TP_INSTANCE:-r3}"
DATA="/tmp/tokenproxy-${INSTANCE}-data"
PID="/tmp/tokenproxy-${INSTANCE}.pid"
PROVENANCE="/tmp/tokenproxy-${INSTANCE}-provenance.json"
if [ ! -s "$PROVENANCE" ] || [ ! -s "$PID" ]; then
  echo "isolated provenance is missing for ${INSTANCE}; run docs/design/verification/instance.sh restart"
  exit 1
fi
pid=$(cat "$PID" 2>/dev/null || true)
if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null \
  || ! tr '\0' '\n' <"/proc/$pid/environ" 2>/dev/null | grep -qx "DATA_DIR=$DATA"; then
  echo "isolated process ownership mismatch for ${INSTANCE}"
  exit 1
fi
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
