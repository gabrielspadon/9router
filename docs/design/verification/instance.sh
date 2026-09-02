#!/usr/bin/env bash
# Isolated verification instance. Its own port, its own DATA_DIR, and its own copy of
# the built app, so a later rebuild in the worktree never disturbs a running
# instance. Production (20128 front-proxy) and the foreign tokenproxy (20129) are
# never touched.
#
#   docs/design/verification/instance.sh up      build, snapshot, seed, start
#   docs/design/verification/instance.sh restart rebuild and re-snapshot, then start
#   docs/design/verification/instance.sh down    stop
#   docs/design/verification/instance.sh status
set -uo pipefail
cd "$(dirname "$0")/../../.." || exit 2

INSTANCE="${TP_INSTANCE:-r3}"
case "$INSTANCE" in
  ""|*[!A-Za-z0-9_-]*) echo "TP_INSTANCE must use only letters, digits, _ or -"; exit 2 ;;
esac
PORT="${TP_PORT:-20135}"
APP="/tmp/tokenproxy-${INSTANCE}-app"
SOURCE="/tmp/tokenproxy-${INSTANCE}-source"
BUILD="$SOURCE/.next"
DATA="$(realpath -m "${TP_DATA_DIR:-/tmp/tokenproxy-${INSTANCE}-data}")"
BUILD_DATA="/tmp/tokenproxy-${INSTANCE}-build-data"
case "$DATA" in
  "/tmp/tokenproxy-${INSTANCE}-"*) ;;
  *) echo "TP_DATA_DIR must remain a private /tmp directory for this instance"; exit 2 ;;
esac
PID="/tmp/tokenproxy-${INSTANCE}.pid"
LOG="/tmp/tokenproxy-${INSTANCE}.log"
ENV="/tmp/tokenproxy-${INSTANCE}.env"
BUILD_LOG="/tmp/tokenproxy-${INSTANCE}-build.log"
PROVENANCE="/tmp/tokenproxy-${INSTANCE}-provenance.json"

pid() { [ -f "$PID" ] && cat "$PID" 2>/dev/null || true; }
alive() { local p; p=$(pid); [ -n "$p" ] && kill -0 "$p" 2>/dev/null && owns "$p"; }

port_taken() { ss -ltn 2>/dev/null | grep -q ":${PORT} "; }

ensure_env() {
  [ -s "$ENV" ] && return
  umask 077
  {
    printf 'JWT_SECRET=%s\n' "$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
    printf 'API_KEY_SECRET=%s\n' "$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
    printf 'MACHINE_ID_SALT=%s\n' "$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
  } >"$ENV"
}

# `docs/design/evidence` and `GATES.md` are excluded because they are written
# FROM a capture, not built INTO one. Including them makes the digest impossible
# to satisfy: recording the run's own result would drift the digest the run just
# recorded. Everything that can change what the build serves is still in.
source_digest() {
  (
    cd "${1:-$SOURCE}"
    find . \
      \( -name .git -o -name .claude -o -name .next -o -name .next-r3 \
         -o -name node_modules -o -name .env -o -path ./docs/design/evidence \
         -o -path ./GATES.md \) \
      -prune -o -type f -print0 \
      | sort -z \
      | xargs -0 sha256sum
  ) | sha256sum | awk '{print $1}'
}

# Comparing the provenance file against its own copy proves only that the copy
# happened. It says nothing about whether the checkout still matches the build
# the instance is serving, which is the claim every capture rests on.
snapshot_verified() {
  [ -s "$PROVENANCE" ] && [ -s "$APP/.verification-provenance.json" ] \
    && cmp -s "$PROVENANCE" "$APP/.verification-provenance.json" || return 1
  local recorded live
  recorded=$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).sourceDigest||"")' "$PROVENANCE")
  live=$(source_digest .)
  [ -n "$recorded" ] && [ "$recorded" = "$live" ] && return 0
  echo "source digest drift: snapshot $recorded, checkout $live"
  return 1
}

snapshot() {
  echo "[build] npm run build"
  ensure_env
  set -a
  . "$ENV"
  set +a
  # Compile a source snapshot with its own dependencies. The shared checkout can
  # be active in another session, so its .next and node_modules stay untouched.
  # Static generation can initialize SQLite. Keep that disposable build state
  # away from DATA so `seed` still creates the authorized real-data copy.
  rm -rf "$SOURCE" "$BUILD_DATA"
  mkdir -p "$SOURCE"
  rsync -a \
    --exclude=.git \
    --exclude=.claude \
    --exclude=.next \
    --exclude=.next-r3 \
    --exclude=node_modules \
    --exclude=tests/node_modules \
    --exclude=.env \
    ./ "$SOURCE"/
  (
    cd "$SOURCE"
    mise x node@24.15.0 -- npm install --no-audit --no-fund
    NEXT_DIST_DIR=.next DATA_DIR="$BUILD_DATA" mise x node@24.15.0 -- npm run build
  ) >"$BUILD_LOG" 2>&1 || {
    echo "BUILD FAILED"; tail -30 "$BUILD_LOG"; exit 1; }
  echo "[snapshot] $BUILD -> $APP"
  rm -rf "$APP"; mkdir -p "$APP"
  cp -a "$BUILD"/standalone/. "$APP"/
  # Next's standalone trace omits this runtime-only machine identity dependency.
  cp -a "$SOURCE"/node_modules/node-machine-id "$APP"/node_modules/
  # Dynamic server imports resolve from process.cwd(), outside Next's trace.
  mkdir -p "$APP"/open-sse
  cp -a "$SOURCE"/open-sse/. "$APP"/open-sse/
  # proxyFetch dynamically loads these transport modules, also outside tracing.
  cp -a "$SOURCE"/node_modules/{undici,socks-proxy-agent,agent-base,debug,socks,smart-buffer,ip-address,ms} "$APP"/node_modules/
  mkdir -p "$APP/.next"
  cp -a "$BUILD"/static "$APP/.next/static"
  [ -d "$SOURCE"/public ] && cp -a "$SOURCE"/public "$APP"/ 2>/dev/null
  # The standalone server reads .env from its own working directory, so the
  # snapshot needs its own copy or every secret-dependent route fails at runtime
  # while the dashboard page itself still answers 200.
  cp "$ENV" "$APP"/.env
  local source_sha build_id
  source_sha=$(source_digest)
  build_id=$(cat "$BUILD/BUILD_ID")
  printf '{"instance":"%s","sourceDigest":"%s","buildId":"%s"}\n' \
    "$INSTANCE" "$source_sha" "$build_id" >"$PROVENANCE"
  cp "$PROVENANCE" "$APP/.verification-provenance.json"
}

seed_source() {
  local source="${TP_SEED_DATA_DIR:-}"
  if [ -z "$source" ]; then
    echo "TP_SEED_DATA_DIR must name the live data directory to seed from" >&2
    return 2
  fi
  if [ ! -f "$source/db/data.sqlite" ]; then
    echo "TP_SEED_DATA_DIR has no db/data.sqlite: $source" >&2
    return 2
  fi
  printf '%s\n' "$source"
}

seed() {
  mkdir -p "$DATA/db"
  if [ ! -f "$DATA/db/data.sqlite" ]; then
    local source
    source=$(seed_source) || return $?
    # Read-only online backup of the live DB, so the audit runs against realistic
    # provider/usage data. Never writes to the source file.
    echo "[seed] sqlite3 .backup from explicit live DB (read-only on source)"
    sqlite3 "$source/db/data.sqlite" ".backup '$DATA/db/data.sqlite'" \
      && rm -f "$DATA"/db/data.sqlite-wal "$DATA"/db/data.sqlite-shm
    for f in usage.json log.txt; do
      [ -f "$source/$f" ] && cp "$source/$f" "$DATA/$f" 2>/dev/null
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
  if alive; then echo "already running: pid $(pid) -> http://${TP_HOST:-127.0.0.1}:$PORT"; return 0; fi
  if port_taken; then
    echo "PORT $PORT is held by another process; refusing to touch it."
    ss -ltnp 2>/dev/null | grep ":${PORT} "; exit 1
  fi
  [ -d "$APP" ] || snapshot
  if ! snapshot_verified; then
    echo "isolated snapshot has no matching provenance; run restart before verification"
    exit 1
  fi
  seed
  echo "[start] :$PORT DATA_DIR=$DATA"
  # Background the command itself, never a `cd && cmd` compound: backgrounding a
  # compound forks a subshell and $! is the subshell, not the server.
  ensure_env
  set -a
  . "$ENV"
  set +a
  DISABLE_BACKGROUND_TOKEN_REFRESH=1 DATA_DIR="$DATA" PORT="$PORT" HOSTNAME="${TP_HOST:-127.0.0.1}" \
    nohup env -C "$APP" mise x node@24.15.0 -- node custom-server.js >"$LOG" 2>&1 &
  echo $! >"$PID"
  for _ in $(seq 1 40); do
    code=$(curl -sq -o /dev/null -w '%{http_code}' --max-time 3 "http://${TP_HOST:-127.0.0.1}:$PORT/dashboard" 2>/dev/null || true)
    [ "$code" = "200" ] && { echo "ok: pid $(pid) -> http://${TP_HOST:-127.0.0.1}:$PORT"; return 0; }
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
  restart) down || exit $?; snapshot; up ;;
  snapshot) snapshot ;;
  seed-source) seed_source ;;
  status)
    if alive; then echo "running pid $(pid) -> http://${TP_HOST:-127.0.0.1}:$PORT"; else echo "not running"; fi
    curl -sq -o /dev/null -w 'health=%{http_code}\n' --max-time 3 "http://${TP_HOST:-127.0.0.1}:$PORT/dashboard" 2>/dev/null || true ;;
  *) echo "usage: instance.sh up|down|restart|snapshot|seed-source|status"; exit 2 ;;
esac
