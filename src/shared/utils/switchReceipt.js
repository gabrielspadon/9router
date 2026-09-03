/**
 * Account-switch receipts — Account Scheduling Contract rule 8: persist the
 * reason for every switch without storing secrets or prompt bodies. Required
 * fields are old and new connection IDs, normalized quota windows, trigger,
 * model, session hash, and timestamp.
 *
 * Pure. No DB imports and no wall-clock read: `now` is injected, so a receipt
 * is a function of its inputs and a receipt test is deterministic.
 *
 * The safety property is structural, not a review habit. This module NEVER
 * spreads an input object into its output — every field is picked by name and
 * coerced — so adding a token, a key or a prompt body to a connection record
 * upstream cannot leak it into a persisted receipt. The exported key list is
 * the whole contract; a test asserts the exact key set, so a later field
 * addition that leaks is a failing test rather than a silent disclosure.
 */

import { normalizeAccountWindows } from '@/shared/utils/quotaRanking.js';

/**
 * The complete receipt key set, in rule 8's own order. Exported so a caller
 * (and the persistence layer) can assert against one list rather than each
 * re-deriving it.
 */
export const RECEIPT_KEYS = Object.freeze([
  'fromConnectionId',
  'toConnectionId',
  'windows',
  'trigger',
  'model',
  'sessionHash',
  'at',
]);

// A connection id may arrive as a bare id or as the connection record the
// scheduler was holding. Only the id is ever read off the record: taking the
// object itself is how a secret ends up in a receipt.
function connectionId(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value === '' ? null : value;
  if (typeof value === 'object') {
    const id = value.id ?? value.connectionId;
    return typeof id === 'string' && id !== '' ? id : null;
  }
  return null;
}

function text(value) {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Normalized quota windows for the receipt.
 *
 * quotaRanking.normalizeAccountWindows is the ONLY authority for what
 * "normalized" means, so the receipt records exactly the shape the ranking
 * decision was made from — the evidence, not a second rendering of it. Its
 * output already drops every field outside the contract's window vocabulary,
 * which is a second reason to reuse it rather than re-project raw records.
 *
 * An unrankable window set yields an empty array rather than raw passthrough:
 * a receipt is a record of evidence, and unclassifiable input is not evidence.
 * The trigger still carries why the switch happened.
 */
function normalizedWindows(windows) {
  const norm = normalizeAccountWindows(windows);
  if (!norm.ok) return [];
  return norm.windows.map((w) => ({
    scope: w.scope,
    remaining: w.remaining,
    limit: w.limit,
    resetAt: new Date(w.resetAt).toISOString(),
    confidence: w.confidence,
  }));
}

/**
 * Build one switch receipt.
 *
 * @param {object} input
 * @param {string|{id: string}|null} input.from - the account being left. null
 *   for a first pin, which is a switch from nothing and still worth recording.
 * @param {string|{id: string}} input.to - the account being pinned.
 * @param {Array<object>} input.windows - the raw quota windows that drove it.
 * @param {string} input.trigger - why: 'exhausted', 'reset-repin', 'drain',
 *   'model-failure', 'first-pin', 'unavailable'. Free-form by design; the
 *   contract requires the field, not a closed vocabulary.
 * @param {string} input.model
 * @param {string} input.sessionHash - a HASH. Never the raw client session
 *   identity, never a secret, never a prompt body.
 * @param {number|Date} input.now - REQUIRED and injected.
 * @returns {{fromConnectionId: string|null, toConnectionId: string|null,
 *   windows: Array<object>, trigger: string|null, model: string|null,
 *   sessionHash: string|null, at: string}}
 */
export function buildSwitchReceipt({ from, to, windows, trigger, model, sessionHash, now } = {}) {
  const atMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(atMs)) {
    throw new TypeError('buildSwitchReceipt requires an injected numeric or Date `now`');
  }
  return {
    fromConnectionId: connectionId(from),
    toConnectionId: connectionId(to),
    windows: normalizedWindows(windows),
    trigger: text(trigger),
    model: text(model),
    sessionHash: text(sessionHash),
    at: new Date(atMs).toISOString(),
  };
}
