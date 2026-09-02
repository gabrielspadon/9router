import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const SCOPE = "disabledModels";

// Per-account (#1527) disables live under a second key shape, `alias::connectionId`,
// beside the provider-wide `alias` key that predates them. Two rules keep an
// existing install intact:
//   read  — a connection with no key of its own INHERITS the provider key, so
//           every set saved before this change keeps applying to every account.
//   write — a connection-scoped write never touches the provider key, so one
//           account's edit cannot re-enable a model for the other accounts.
// A connection's key is written as `[]` rather than deleted when its last model
// is re-enabled; deleting it would fall back to the provider set and silently
// re-disable what the operator just enabled.
const connKey = (providerAlias, connectionId) => `${providerAlias}::${connectionId}`;

function readKey(db, key) {
  const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, key]);
  return row ? (parseJson(row.value, []) || []) : null;
}

function writeKey(db, key, ids) {
  db.run(
    `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
    [SCOPE, key, stringifyJson(ids)]
  );
}

// The whole disabled set, cached. Routing consults this on the request path now
// that a direct request for a disabled model is refused (#577), and combo member
// filtering already did per combo request, so an uncached read here is one SQL
// round trip per request. The set changes only when an operator toggles a model,
// which is why the writers below invalidate rather than the readers polling.
//
// The TTL is a backstop for a write that did not come through this process, not
// the primary freshness mechanism.
const CACHE_TTL_MS = 5000;
let cache = null;
let cachedAt = 0;

export function invalidateDisabledModelsCache() {
  cache = null;
  cachedAt = 0;
}

export async function getDisabledModels() {
  if (cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache;
  const db = await getAdapter();
  const rows = db.all(`SELECT key, value FROM kv WHERE scope = ?`, [SCOPE]);
  const out = {};
  for (const r of rows) out[r.key] = parseJson(r.value, []);
  cache = out;
  cachedAt = Date.now();
  return out;
}

// connectionId omitted → the provider-wide set. Given → that connection's own
// set, falling back to the provider-wide one when it has never been edited.
export async function getDisabledByProvider(providerAlias, connectionId = null) {
  const db = await getAdapter();
  if (connectionId) {
    const own = readKey(db, connKey(providerAlias, connectionId));
    if (own) return own;
  }
  return readKey(db, providerAlias) || [];
}

// Atomic read-merge-write inside a transaction (no JS yield mid-transaction).
export async function disableModels(providerAlias, ids, connectionId = null) {
  invalidateDisabledModelsCache();
  if (!providerAlias || !Array.isArray(ids)) return;
  const db = await getAdapter();
  db.transaction(() => {
    const key = connectionId ? connKey(providerAlias, connectionId) : providerAlias;
    // First write for a connection starts from what it was inheriting, so the
    // provider-wide set isn't dropped the moment one model is added to it.
    const current = readKey(db, key) || (connectionId ? readKey(db, providerAlias) || [] : []);
    writeKey(db, key, [...new Set([...current, ...ids])]);
  });
}

export async function enableModels(providerAlias, ids, connectionId = null) {
  invalidateDisabledModelsCache();
  if (!providerAlias) return;
  const db = await getAdapter();
  db.transaction(() => {
    if (connectionId) {
      const key = connKey(providerAlias, connectionId);
      const current = readKey(db, key) || readKey(db, providerAlias) || [];
      const removeSet = new Set(Array.isArray(ids) ? ids : []);
      const next = removeSet.size === 0 ? [] : current.filter((id) => !removeSet.has(id));
      writeKey(db, key, next); // `[]` is a real value here, not an absent key
      return;
    }
    if (!Array.isArray(ids) || ids.length === 0) {
      db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerAlias]);
      return;
    }
    const current = readKey(db, providerAlias) || [];
    const removeSet = new Set(ids);
    const next = current.filter((id) => !removeSet.has(id));
    if (next.length === 0) {
      db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [SCOPE, providerAlias]);
    } else {
      writeKey(db, providerAlias, next);
    }
  });
}
