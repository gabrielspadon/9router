import crypto from "crypto";

// NOT a secret, and the name is the only thing about it that ever suggested it
// was. The CRC below is computed over machineId and keyId, and BOTH of those
// travel inside the key in plaintext, so an HMAC over them proves only that the
// two halves belong together. It is an integrity checksum that catches a
// truncated or hand-mistyped key before it reaches a database lookup. Whatever
// value this holds, it adds ZERO bits to the guessing difficulty of a key, and
// the default literal shipping in source made that explicit rather than causing
// it.
//
// The default is deliberately NOT randomized per install. Changing it changes
// the CRC of every key already issued, so parseApiKey would reject the whole
// fleet at once. The secrecy has to come from the keyId, which is what
// generateKeyId now provides.
const API_KEY_CHECKSUM_SECRET =
  process.env.API_KEY_SECRET || "endpoint-proxy-api-key-secret";

// 128 bits from the CSPRNG, hex-encoded. Two properties are load-bearing.
//
// FIRST, THE SOURCE. This used to be six characters drawn from a 36-character
// alphabet with Math.random(), which is 36^6, about 2.18e9, or 31 bits — and
// only 31 bits against an attacker with no other information. Math.random() is
// xorshift128+, not a CSPRNG: its internal state is recoverable from a handful
// of outputs, so an attacker holding one key minted by a process could predict
// the next ones outright rather than searching at all. Everything this endpoint
// minted before this change is weak in both senses, and no amount of masking or
// checksumming repairs one already issued. The remedy for those is rotation,
// which is an operator action rather than something this function can do.
//
// SECOND, THE ALPHABET. The key format splits on "-", so the keyId must never
// contain one. Hex has no "-" and needs no rejection sampling, which is why it
// is used here in preference to base64url.
const KEY_ID_BYTES = 16;

function generateKeyId() {
  return crypto.randomBytes(KEY_ID_BYTES).toString("hex");
}

// Integrity checksum over the key's two public halves. See the constant above
// for why this is not a secrecy mechanism.
function generateCrc(machineId, keyId) {
  return crypto
    .createHmac("sha256", API_KEY_CHECKSUM_SECRET)
    .update(machineId + keyId)
    .digest("hex")
    .slice(0, 8);
}

/**
 * Generate API key with machineId embedded
 * Format: sk-{machineId}-{keyId}-{crc8}
 * @param {string} machineId - 16-char machine ID
 * @returns {{ key: string, keyId: string }}
 */
export function generateApiKeyWithMachine(machineId) {
  const keyId = generateKeyId();
  const crc = generateCrc(machineId, keyId);
  const key = `sk-${machineId}-${keyId}-${crc}`;
  return { key, keyId };
}

// How much of a keyId may be shown to identify a key without carrying it. The
// machineId is identical for every key on one install and is readable from any
// key the viewer already holds, and the CRC is derivable from machineId plus
// keyId, so a display that shows a keyId IN FULL hands over the whole thing.
// Six hex characters separate the keys an install actually has while leaving
// 122 bits unshown.
export const KEY_ID_DISPLAY_CHARS = 6;

/**
 * Parse API key and extract machineId + keyId
 * Supports both formats:
 * - New: sk-{machineId}-{keyId}-{crc8}
 * - Old: sk-{random8}
 * @param {string} apiKey
 * @returns {{ machineId: string, keyId: string, isNewFormat: boolean } | null}
 */
export function parseApiKey(apiKey) {
  // typeof first: a caller handing this a number or an object used to reach
  // .startsWith and throw, turning a malformed bearer into a 500 instead of the
  // refusal it is.
  if (typeof apiKey !== "string" || !apiKey.startsWith("sk-")) return null;

  const parts = apiKey.split("-");

  // New format: sk-{machineId}-{keyId}-{crc8} = 4 parts. The keyId width is not
  // checked, so a 6-char keyId minted before the widening still parses and its
  // holder is not locked out by this change.
  if (parts.length === 4) {
    const [, machineId, keyId, crc] = parts;

    const expectedCrc = generateCrc(machineId, keyId);
    // Fixed-time compare. The CRC guards integrity rather than secrecy, but a
    // length-varying early-exit comparison here is free to avoid and leaves
    // nothing to argue about later.
    const a = Buffer.from(String(crc));
    const b = Buffer.from(expectedCrc);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    return { machineId, keyId, isNewFormat: true };
  }

  // Old format: sk-{random8} = 2 parts
  if (parts.length === 2) {
    return { machineId: null, keyId: parts[1], isNewFormat: false };
  }

  return null;
}

/**
 * Verify API key CRC (only for new format)
 * @param {string} apiKey
 * @returns {boolean}
 */
export function verifyApiKeyCrc(apiKey) {
  const parsed = parseApiKey(apiKey);
  if (!parsed) return false;

  // Old format doesn't have CRC, always valid if parsed
  if (!parsed.isNewFormat) return true;

  // New format already verified in parseApiKey
  return true;
}

/**
 * Check if API key is new format (contains machineId)
 * @param {string} apiKey
 * @returns {boolean}
 */
export function isNewFormatKey(apiKey) {
  const parsed = parseApiKey(apiKey);
  return parsed?.isNewFormat === true;
}
