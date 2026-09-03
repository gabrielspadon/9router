/**
 * One redactor for every persistence path.
 *
 * Header masking used to live twice — `requestLogger.js` for the disk logs and
 * `requestDetailsRepo.js` for the DB rows — on two key lists that had already
 * drifted (`secret` was in one, not the other). Bodies were redacted in neither:
 * both paths size-truncated whole request, provider-request and provider-response
 * payloads and wrote what fit. A secret embedded in a BODY rather than a header
 * therefore reached disk and the `requestDetails` table verbatim, and from there
 * every projection built on them.
 *
 * The two header behaviours genuinely differ and both are load-bearing, so they
 * stay two functions over ONE key list: the DB row drops the header (nothing
 * downstream reads it), the disk log keeps scheme plus a 4-char tail (an operator
 * comparing two sessions needs to tell two accounts apart).
 *
 * Failure direction is closed. `redactSecrets` returns a marker rather than the
 * input if the walk throws on a shape it cannot handle, so an unparseable body is
 * dropped rather than persisted unredacted.
 */

export const REDACTED = '[redacted]';

/**
 * Header names are matched on SUBSTRING, because a proxy sees vendor-prefixed
 * names it has never heard of (`x-tp-peer-token`, `x-goog-api-key`) and the
 * conservative read of an unknown `*-token` header is that it grants something.
 */
const SENSITIVE_HEADER_SUBSTRINGS = [
  'authorization',
  'api-key',
  'apikey',
  'cookie',
  'token',
  'secret',
  'password',
];

/**
 * Body keys are matched WHOLE, because the substring rule that is right for
 * headers is wrong here: `prompt_tokens`, `completion_tokens` and `max_tokens`
 * are the accounting fields this record exists to carry, and a substring match on
 * "token" would blank all three.
 */
const SECRET_BODY_KEYS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'token',
  'access-token',
  'refresh-token',
  'id-token',
  'auth-token',
  'session-token',
  'api-key',
  'apikey',
  'x-api-key',
  'x-goog-api-key',
  'secret',
  'client-secret',
  'secret-key',
  'private-key',
  'access-key',
  'password',
  'passwd',
]);

// Value shapes, for a secret sitting under a key that names nothing (a prompt
// that quotes a curl command, an error body echoing the request that failed).
const BEARER = /\b(?:Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g;
// Issuer prefixes, each followed by a separator and a long body. The 15-char
// floor keeps a human label ("sk_tokenproxy (default)") from reading as the key
// it names.
const KEY_PREFIX =
  'sk|xai|pt|gsk|pk|ghp|gho|ghs|ghu|github_pat|AKIA|ASIA|glpat|xoxb|xoxp|xapp|hf|nvapi|dop_v1|shpat';
const PREFIXED_KEY = new RegExp(`\\b(?:${KEY_PREFIX})[-_][A-Za-z0-9][A-Za-z0-9_-]{15,}`, 'gi');
// Google keys carry no separator.
const GOOGLE_KEY = /\bAIza[A-Za-z0-9_-]{20,}/g;

const MAX_DEPTH = 24;

const normalizeKey = (name) => String(name).toLowerCase().replace(/_/g, '-');

export function isSensitiveHeaderName(name) {
  const lower = normalizeKey(name);
  return SENSITIVE_HEADER_SUBSTRINGS.some((s) => lower.includes(s));
}

export function isSecretBodyKey(name) {
  return SECRET_BODY_KEYS.has(normalizeKey(name));
}

/** DB path: a sensitive header is dropped outright. */
export function stripSensitiveHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!isSensitiveHeaderName(key)) out[key] = value;
  }
  return out;
}

/**
 * Disk-log path: keep the auth scheme so logs still show which auth path ran,
 * plus the last 4 chars to tell two accounts apart — never the secret itself.
 * Short values are masked too: a 12-char key is no less sensitive than a 40-char
 * one.
 */
export function maskSensitiveHeaders(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const masked = { ...headers };
  for (const key of Object.keys(masked)) {
    if (!isSensitiveHeaderName(key)) continue;
    const value = masked[key];
    if (typeof value !== 'string' || !value) continue;
    const parts = value.match(/^(\S+)\s+(.*)$/);
    const scheme = parts && /^(bearer|basic|token)$/i.test(parts[1]) ? `${parts[1]} ` : '';
    const secret = scheme ? parts[2] : value;
    masked[key] = `${scheme}***${secret.length > 4 ? secret.slice(-4) : ''}`;
  }
  return masked;
}

/** Replace secret-shaped runs inside free text, leaving the rest readable. */
export function redactSecretsText(text) {
  if (typeof text !== 'string' || text === '') return text;
  return text
    .replace(JWT, REDACTED)
    .replace(BEARER, (match) => `${match.split(/\s+/)[0]} ${REDACTED}`)
    .replace(PREFIXED_KEY, REDACTED)
    .replace(GOOGLE_KEY, REDACTED);
}

function walk(value, depth, seen) {
  if (typeof value === 'string') return redactSecretsText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[depth-limited]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1, seen));
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = isSecretBodyKey(key) ? REDACTED : walk(child, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

/**
 * Deep-redact a value destined for persistence. Non-secret fields survive
 * untouched — a log with the model, the tool names and the token counts blanked
 * is not a safer log, it is a useless one.
 *
 * Fails CLOSED: a shape the walk cannot handle yields a marker, never the input.
 */
export function redactSecrets(value) {
  try {
    return walk(value, 0, new Set());
  } catch {
    return { redacted: true, reason: 'redaction failed' };
  }
}
