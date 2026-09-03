/**
 * Per-account capacity resolution — Account Scheduling Contract rule 7:
 * "Make capacity configurable per connection. A high-capacity account may
 * accept dozens of concurrent requests while another accepts only a few.
 * Provider-wide policy remains an optional outer safety ceiling, not the
 * only gate."
 *
 * Pure. No DB imports. The per-connection value is stored on the connection
 * (`maxConcurrent`), which connectionsRepo round-trips through the encrypted
 * `data` column, so no schema column is needed for it and an account that
 * never configured one keeps the documented default.
 *
 * The provider-wide ceiling already exists as
 * settings.providerStrategies[<provider>].maxConcurrent, read by
 * providerConcurrencyOverflow() in src/sse/handlers/chat.js. This module does
 * not replace it; it makes the per-account gate the primary one and the
 * provider ceiling an OPTIONAL outer bound, which is the inversion rule 7
 * asks for.
 */

// overlay-spec §8 resolves the two source values (2 and 80) in favour of 80:
// the acceptance contract requires 80 concurrent isolated requests to complete
// or wait without starvation, which a ceiling of 2 cannot satisfy. It stays a
// live configuration knob rather than a compiled-in constant because both
// values are observed in the wild.
export const DEFAULT_ACCOUNT_CAPACITY = 80;

// §2/§8 sentinel: 0 (and any non-positive or non-integer value) means
// "no limit configured" — the gate is skipped entirely. This is distinct from
// a limit of 1, which still gates. A malformed ceiling therefore fails OPEN on
// configuration, per §8's stated failure direction, rather than throttling an
// account to zero because someone typed a string.
export const UNGATED = 0;

// No Number() coercion: providerConcurrencyOverflow() in
// src/sse/handlers/chat.js already tests Number.isInteger on the RAW value, so
// a string "4" is not a limit there. Coercing here would give the codebase two
// different definitions of a valid concurrency setting and let a value the
// provider gate ignores silently throttle the account gate.
function positiveIntOrNull(value) {
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

/**
 * Capacity for one connection.
 *
 * @param {object|null} connection - carries an optional `maxConcurrent`.
 * @param {object} [options]
 * @param {number} [options.defaultCapacity] - used when the connection
 *   configures none. Defaults to DEFAULT_ACCOUNT_CAPACITY.
 * @returns {number} a positive integer slot count, or UNGATED (0) when the
 *   resolved value is explicitly ungated.
 */
export function resolveAccountCapacity(
  connection,
  { defaultCapacity = DEFAULT_ACCOUNT_CAPACITY } = {}
) {
  const configured = connection?.maxConcurrent;
  // An explicit 0 is a deliberate "ungated", not a missing value, so it is
  // honoured rather than replaced by the default.
  if (configured === 0) return UNGATED;
  const own = positiveIntOrNull(configured);
  if (own !== null) return own;
  if (configured !== undefined && configured !== null) {
    // Present but malformed (a string, a float, a negative). Fail open to the
    // default rather than to zero: throttling an account to nothing because a
    // setting is mistyped is the worse failure.
    return positiveIntOrNull(defaultCapacity) ?? DEFAULT_ACCOUNT_CAPACITY;
  }
  return positiveIntOrNull(defaultCapacity) ?? DEFAULT_ACCOUNT_CAPACITY;
}

/**
 * Provider-wide ceiling, OPTIONAL and additional. Absent, malformed or
 * non-positive means no outer bound at all — the per-account gate is still in
 * force, which is the whole point of rule 7.
 *
 * @param {object|null} settings - the settings object carrying providerStrategies.
 * @param {string} provider
 * @returns {number|null} a positive integer, or null for "no ceiling".
 */
export function resolveProviderCeiling(settings, provider) {
  return positiveIntOrNull(settings?.providerStrategies?.[provider]?.maxConcurrent);
}

/**
 * Effective admission limit for one connection: the per-account capacity,
 * bounded by the provider ceiling only when one is configured.
 *
 * @returns {{limit: number, gated: boolean, source: string}}
 *   `gated` false means no limit applies and the caller skips the gate (§2).
 *   `source` names which rule produced the number, so a switch receipt (rule 8)
 *   can record WHY a request queued without storing any credential.
 */
export function effectiveCapacity(
  connection,
  { settings = null, provider = null, defaultCapacity } = {}
) {
  const account = resolveAccountCapacity(connection, { defaultCapacity });
  const ceiling = resolveProviderCeiling(settings, provider ?? connection?.provider ?? null);

  if (account === UNGATED) {
    // The account is explicitly ungated. A provider ceiling, when configured,
    // is still an outer safety bound — "optional and additional", never
    // discarded because the inner gate opted out.
    if (ceiling === null) return { limit: UNGATED, gated: false, source: 'account-ungated' };
    return { limit: ceiling, gated: true, source: 'provider-ceiling' };
  }
  if (ceiling === null) return { limit: account, gated: true, source: 'account' };
  return ceiling < account
    ? { limit: ceiling, gated: true, source: 'provider-ceiling' }
    : { limit: account, gated: true, source: 'account' };
}
