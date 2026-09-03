#!/usr/bin/env bash
# G1: migrations add the normalized quota-window and session-affinity tables and
# run clean on a FRESH data dir.
#
# The data dir is a mktemp -d, exported as DATA_DIR before any repo module is
# imported, and removed on exit. The real data directory and its credential DB
# are never opened, read, written or backed up by this script — a migration
# verifier that mutates the live store is a data-loss event, not a gate.
#
# Prints exactly MIGRATIONS_OK on success. On failure it names every missing
# table and column and exits non-zero.
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

tmp_data_dir="$(mktemp -d "${TMPDIR:-/tmp}/tokenproxy-migrate-verify.XXXXXX")"
cleanup() { rm -rf -- "$tmp_data_dir"; }
trap cleanup EXIT

# Consumed by src/lib/dataDir.js, which is the single source of the DB path.
export DATA_DIR="$tmp_data_dir"

# The driver imports "@/lib/dataDir.js"; that alias is a bundler concern, so a
# bare `node` run needs it resolved. A module-resolution hook is the smallest
# thing that works and keeps the verifier running the REAL migration path
# (runMigrationOnce over TABLES) rather than a reimplementation of it, which
# would prove nothing about the code that ships.
node --input-type=module -e '
import { register } from "node:module";
import { pathToFileURL } from "node:url";

const srcUrl = pathToFileURL(process.cwd() + "/src/").href;
const loaderSrc = `
  export function resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(new URL(specifier.slice(2), ${JSON.stringify(srcUrl)}).href, context);
    }
    return nextResolve(specifier, context);
  }
`;
register("data:text/javascript," + encodeURIComponent(loaderSrc), import.meta.url);

const { TABLES, SCHEMA_VERSION } = await import("./src/lib/db/schema.js");
const { getAdapter } = await import("./src/lib/db/driver.js");

// Every table and column this leaf is accountable for. Asserted explicitly and
// not derived from TABLES alone: a check that reads the same object the code
// under test writes would pass even if both were deleted together.
const REQUIRED = {
  quotaWindows: ["connectionId", "scope", "remaining", "limit", "resetAt", "observedAt", "confidence"],
  sessionAffinity: ["sessionHash", "model", "connectionId", "providerNode", "pinnedAt", "expiresAt", "lastSeenAt"],
};

const db = await getAdapter();   // runs runMigrationOnce() lazily
const missing = [];

for (const [table, columns] of Object.entries(REQUIRED)) {
  const info = db.all(`PRAGMA table_info(${table})`);
  if (!info || info.length === 0) {
    missing.push(`table ${table} absent`);
    continue;
  }
  const present = new Set(info.map((r) => r.name));
  for (const col of columns) {
    if (!present.has(col)) missing.push(`column ${table}.${col} absent`);
  }
  if (!TABLES[table]) missing.push(`TABLES entry ${table} absent from schema.js`);
}

// Both tables must round-trip a write, which proves the declared types and the
// composite primary keys are real and not just names in a PRAGMA listing.
try {
  db.run(
    `INSERT INTO quotaWindows(connectionId, scope, remaining, "limit", resetAt, observedAt, confidence)
     VALUES(?, ?, ?, ?, ?, ?, ?)`,
    ["verify-conn", "session (5h)", 120, 300, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "fresh"]
  );
  const w = db.get(`SELECT * FROM quotaWindows WHERE connectionId = ?`, ["verify-conn"]);
  if (!w || Number(w.limit) !== 300) missing.push("quotaWindows row did not round-trip");
} catch (e) {
  missing.push(`quotaWindows insert failed: ${e.message}`);
}

try {
  db.run(
    `INSERT INTO sessionAffinity(sessionHash, model, connectionId, providerNode, pinnedAt, expiresAt, lastSeenAt)
     VALUES(?, ?, ?, ?, ?, ?, ?)`,
    ["verify-hash", "m", "verify-conn", "node-a", "2026-01-01T00:00:00.000Z", null, "2026-01-01T00:00:00.000Z"]
  );
  const a = db.get(`SELECT * FROM sessionAffinity WHERE sessionHash = ? AND model = ?`, ["verify-hash", "m"]);
  if (!a || a.connectionId !== "verify-conn") missing.push("sessionAffinity row did not round-trip");
} catch (e) {
  missing.push(`sessionAffinity insert failed: ${e.message}`);
}

// The pre-change backup in migrate.js only fires when SCHEMA_VERSION moved past
// the stored one, so a new table shipped without a bump silently skips it.
if (!(SCHEMA_VERSION >= 2)) missing.push(`SCHEMA_VERSION is ${SCHEMA_VERSION}, expected >= 2 after adding tables`);

if (missing.length > 0) {
  console.error("MIGRATIONS_FAILED");
  for (const m of missing) console.error(`  - ${m}`);
  process.exit(1);
}
console.log("MIGRATIONS_OK");
' 2>&1 | grep -vE '^\[DB\]|^\(node:|^Reparsing|^To eliminate|^\(Use `node'

# grep sits in the pipeline, so its exit code is not the verifier's verdict.
exit "${PIPESTATUS[0]}"
