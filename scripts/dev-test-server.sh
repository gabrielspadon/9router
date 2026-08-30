#!/bin/bash
# 9router test instance. Runs from source on its own port with its own DATA_DIR,
# fully isolated from production (20128).
# Purpose: verify source changes here first with scripts/smoke-test.mjs, then publish
# with /tmp/9router-deploy.sh.
# Usage: scripts/dev-test-server.sh [up|down|restart|status]   (SKIP_BUILD=1 skips the rebuild)
set -euo pipefail

PORT=20129
DATA_DIR=/tmp/9router-test-data
PID_FILE=/tmp/9router-test.pid
LOG_FILE=/tmp/9router-test.log
cd "$(dirname "$0")/.."

pid() { [ -f "$PID_FILE" ] && cat "$PID_FILE" 2>/dev/null || true; }
alive() { local p; p=$(pid); [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }

up() {
  if alive; then echo "already running: pid $(pid) → http://localhost:$PORT"; exit 0; fi
  if [ "${SKIP_BUILD:-0}" != "1" ] || [ ! -d .next ]; then
    echo "[1/3] build..."
    npm run build >/dev/null 2>&1
  fi
  echo "[2/3] start standalone on :$PORT (DATA_DIR=$DATA_DIR)"
  mkdir -p "$DATA_DIR"
  DATA_DIR="$DATA_DIR" PORT="$PORT" HOSTNAME=127.0.0.1 nohup node .next/standalone/custom-server.js >"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
  echo "[3/3] health check..."
  for _ in $(seq 1 30); do
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/dashboard" || true)
    if [ "$code" = "200" ]; then
      echo "ok: pid $(pid) → http://localhost:$PORT  (log: $LOG_FILE)"
      exit 0
    fi
    sleep 1
  done
  echo "FAILED health check — log tail:"; tail -20 "$LOG_FILE"; exit 1
}

down() {
  if alive; then local p; p=$(pid); kill "$p" && rm -f "$PID_FILE" && echo "stopped pid $p"; else echo "not running"; fi
}

# Cold-copy production data into the test DATA_DIR. sqlite3 .backup is an online-safe
# backup, it takes no lock and never writes to the production files.
# Afterwards 20129 shows the same connections, nodes and statistics as production, and
# any action in the UI writes only to the test copy.
sync() {
  down >/dev/null 2>&1 || true
  echo "[sync] production DB → ${DATA_DIR} (.backup, read-only source)"
  mkdir -p "$DATA_DIR/db"
  sqlite3 "$HOME/.9router/db/data.sqlite" ".backup '$DATA_DIR/db/data.sqlite'"
  rm -f "$DATA_DIR"/db/data.sqlite-wal "$DATA_DIR"/db/data.sqlite-shm
  for f in usage.json log.txt; do
    [ -f "$HOME/.9router/$f" ] && cp "$HOME/.9router/$f" "$DATA_DIR/$f" 2>/dev/null || true
  done
  echo "done. start with: scripts/dev-test-server.sh up  → http://localhost:${PORT} (same password as production)"
}

case "${1:-up}" in
  up) up ;;
  down) down ;;
  restart) down || true; up ;;
  sync) sync ;;
  status) if alive; then echo "running: pid $(pid) → http://localhost:$PORT"; else echo "not running"; fi ;;
  *) echo "usage: $0 [up|down|restart|sync|status]"; exit 1 ;;
esac
