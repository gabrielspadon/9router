// A driver may hand a JSON column back as bytes rather than as text:
// better-sqlite3 returns a BLOB-typed value as a Buffer, and sql.js returns one
// as a Uint8Array. Decoding has to happen BEFORE the already-parsed
// short-circuit below, because a Buffer is also `typeof "object"`.
//
// Returning the bytes unparsed is not a cosmetic wart. Every caller here reads
// a row and writes it back with an object spread, and spreading a Buffer yields
// one key per byte. That byte-spread then persists as the new row, so the real
// contents survive only as numeric noise and every named key reverts to its
// default on the next read. It destroyed a live settings row this way,
// including the stored dashboard password hash, which silently returned the
// gateway to its public default password.
function decodeBytes(value) {
  if (typeof Buffer !== undefined && Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  if (value instanceof Uint8Array) {
    return new TextDecoder().decode(value);
  }
  return null;
}

export function parseJson(str, fallback = null) {
  if (str == null) return fallback;
  const decoded = decodeBytes(str);
  if (decoded !== null) {
    try { return JSON.parse(decoded); } catch { return fallback; }
  }
  if (typeof str !== "string") return str;
  try { return JSON.parse(str); } catch { return fallback; }
}

export function stringifyJson(value) {
  return JSON.stringify(value ?? null);
}
