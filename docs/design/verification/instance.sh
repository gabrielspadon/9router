#!/usr/bin/env bash
# Isolated verification instance. Its own port, its own DATA_DIR, and its own copy of
# the built app, so a later rebuild in the worktree never disturbs a running
# instance. Production (20128 front-proxy) and the foreign 9router (20129) are
# never touched.
#
#   docs/design/verification/instance.sh up      build, snapshot, seed, start
#   docs/design/verification/instance.sh restart rebuild and re-snapshot, then start
#   docs/design/verification/instance.sh down    stop
#   docs/design/verification/instance.sh status
set -uo pipefail
cd "$(dirname "$0")/../../.." || exit 2

PORT="${R3_PORT:-20135}"
APP=/tmp/9router-r3-app
DATA=/tmp/9router-r3-data
PID=/tmp/9router-r3.pid
LOG=/tmp/9router-r3.log

pid() { [ -f "$PID" ] && cat "$PID" 2>/dev/null || true; }
alive() { local p; p=$(pid); [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }

port_taken() { ss -ltn 2>/dev/null | grep -q ":${PORT} "; }

snapshot() {
  echo "[build] npm run build"
  npm run build >/tmp/9router-r3-build.log 2>&1 || {
    echo "BUILD FAILED"; tail -30 /tmp/9router-r3-build.log; exit 1; }
  echo "[snapshot] .next -> $APP"
  rm -rf "$APP"; mkdir -p "$APP"
  cp -a .next/standalone/. "$APP"/
  mkdir -p "$APP/.next"
  cp -a .next/static "$APP/.next/static"
  [ -d public ] && cp -a public "$APP"/ 2>/dev/null
  # The standalone server reads .env from its own working directory, so the
  # snapshot needs its own copy or every secret-dependent route fails at runtime
  # while the dashboard page itself still answers 200.
  [ -f .env ] && cp .env "$APP"/.env
}

seed() {
  mkdir -p "$DATA/db"
  if [ ! -f "$DATA/db/data.sqlite" ] && [ -f "$HOME/.9router/db/data.sqlite" ]; then
    # Read-only online backup of the live DB, so the audit runs against realistic
    # provider/usage data. Never writes to the source file.
    echo "[seed] sqlite3 .backup from live DB (read-only on source)"
    sqlite3 "$HOME/.9router/db/data.sqlite" ".backup '$DATA/db/data.sqlite'" \
      && rm -f "$DATA"/db/data.sqlite-wal "$DATA"/db/data.sqlite-shm
    for f in usage.json log.txt; do
      [ -f "$HOME/.9router/$f" ] && cp "$HOME/.9router/$f" "$DATA/$f" 2>/dev/null
    done
    # The copy carries the live password hash, so the smoke test and the audit
    # could not log in. Reset it to the documented default on the COPY only.
    # Production is opened read-only above and is never written.
    node -e '
      const b = require("bcryptjs"), { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(process.argv[1]);
      const row = db.prepare("SELECT data FROM settings WHERE id = 1").get();
      const s = JSON.parse(row.data);
      s.password = b.hashSync(process.argv[2], 10);
      db.prepare("UPDATE settings SET data = ? WHERE id = 1").run(JSON.stringify(s));
      db.close();
    ' "$DATA/db/data.sqlite" "${SMOKE_PASSWORD:-123456}" \
      && echo "[seed] test-copy password reset to the documented default"
  fi
}

up() {
  if alive; then echo "already running: pid $(pid) -> http://${R3_HOST:-127.0.0.1}:$PORT"; return 0; fi
  if port_taken; then
    echo "PORT $PORT is held by another process; refusing to touch it."
    ss -ltnp 2>/dev/null | grep ":${PORT} "; exit 1
  fi
  [ -d "$APP" ] || snapshot
  seed
  echo "[start] :$PORT DATA_DIR=$DATA"
  # Background the command itself, never a `cd && cmd` compound: backgrounding a
  # compound forks a subshell and $! is the subshell, not the server.
  DATA_DIR="$DATA" PORT="$PORT" HOSTNAME="${R3_HOST:-127.0.0.1}" \
    nohup env -C "$APP" node custom-server.js >"$LOG" 2>&1 &
  echo $! >"$PID"
  for _ in $(seq 1 40); do
    code=$(curl -sq -o /dev/null -w '%{http_code}' --max-time 3 "http://${R3_HOST:-127.0.0.1}:$PORT/dashboard" 2>/dev/null || true)
    [ "$code" = "200" ] && { echo "ok: pid $(pid) -> http://${R3_HOST:-127.0.0.1}:$PORT"; return 0; }
    sleep 1
  done
  echo "FAILED health check"; tail -25 "$LOG"; exit 1
}

# Only ever stops a process proved to be this instance: right port, and its own
# DATA_DIR in its environment. Never guesses from the port alone.
owns() { tr '\0' '\n' < "/proc/$1/environ" 2>/dev/null | grep -qx "DATA_DIR=$DATA"; }

down() {
  local p; p=$(pid)
  if [ -n "$p" ] && kill -0 "$p" 2>/dev/null && owns "$p"; then
    kill "$p" 2>/dev/null; rm -f "$PID"; echo "stopped pid $p"; return 0
  fi
  # Stale pid file: find the listener and stop it only if it is ours.
  local lp
  lp=$(ss -ltnp 2>/dev/null | grep ":${PORT} " | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
  if [ -n "$lp" ] && owns "$lp"; then
    kill "$lp" 2>/dev/null; rm -f "$PID"; echo "stopped pid $lp (recovered from stale pid file)"
  elif [ -n "$lp" ]; then
    echo "port $PORT is held by pid $lp which is NOT this instance; leaving it alone"; return 1
  else
    rm -f "$PID"; echo "not running"
  fi
}

case "${1:-up}" in
  up) up ;;
  down) down ;;
  restart) down >/dev/null 2>&1; snapshot; up ;;
  snapshot) snapshot ;;
  status)
    if alive; then echo "running pid $(pid) -> http://${R3_HOST:-127.0.0.1}:$PORT"; else echo "not running"; fi
    curl -sq -o /dev/null -w 'health=%{http_code}\n' --max-time 3 "http://${R3_HOST:-127.0.0.1}:$PORT/dashboard" 2>/dev/null || true ;;
  *) echo "usage: instance.sh up|down|restart|snapshot|status"; exit 2 ;;
esac
