/**
 * Per-connection admission leases — Account Scheduling Contract rule 6
 * ("Keep selection and reservation in one transaction. Concurrent requests
 * must not all observe the same final slot and over-admit it") and rule 7
 * (capacity is per connection).
 *
 * Pure. No DB imports, no wall-clock reads, no capacity rule of its own: the
 * caller injects `capacityOf`, which is expected to resolve through
 * src/shared/utils/accountCapacity.js so this module and the provider gate in
 * src/sse/handlers/chat.js never disagree about what a limit means.
 *
 * The reservation is the slot. `reserve` counts and admits in one synchronous
 * step, so there is no window between "there is room" and "I took it" for a
 * second caller to observe the same free slot. In a single-threaded runtime
 * that is exactly what makes select-and-reserve atomic, and it is why nothing
 * in this file is async.
 *
 * A lease spans the whole request — held from admission through stream
 * completion, terminal error, client disconnect or abort — and is released
 * exactly once regardless of which of those four paths ends the request.
 */

/**
 * @param {{capacityOf: (connectionId: string) => number}} deps
 *   `capacityOf` returns a positive integer slot count, or the accountCapacity
 *   UNGATED sentinel (0) for "no limit configured". Any other value is treated
 *   as ungated, matching overlay-spec §2's failure direction: fail CLOSED on
 *   capacity, but fail OPEN on missing or malformed configuration rather than
 *   blocking forever on an undefined ceiling.
 * @returns {{
 *   reserve: (connectionId: string) => object|null,
 *   release: (lease: object) => boolean,
 *   inFlight: (connectionId?: string) => number,
 *   snapshot: () => Record<string, number>
 * }}
 */
export function createLeaseRegistry({ capacityOf } = {}) {
  if (typeof capacityOf !== 'function') {
    throw new TypeError('createLeaseRegistry requires an injected capacityOf(connectionId)');
  }

  // connectionId -> Set of lease OBJECTS, identity-keyed rather than a counter.
  // A counter cannot distinguish a second release of one lease from the first
  // release of another, which is precisely the bug that lets a double release
  // (an abort handler and a `finally` both firing) free a different request's
  // slot. Set.delete on the object is inherently idempotent.
  const held = new Map();
  // The most recent refusal per connection, so a caller can print
  // LEASE.refused {held, cap, retry_after} without re-reading capacity rules
  // (docs/logging-design.md row 37). A freed slot only ever comes from a
  // release, so the hint is one short retry window.
  const refusals = new Map();
  const REFUSAL_RETRY_MS = 1000;
  let seq = 0;

  const countOf = (connectionId) => held.get(connectionId)?.size ?? 0;

  /**
   * Take one slot on `connectionId`, or return null when it is full.
   * Never throws on an unknown connection: an unknown id has no leases and its
   * capacity resolution decides, so a caller can probe candidates in ranked
   * order without a try/catch per candidate.
   */
  function reserve(connectionId) {
    if (typeof connectionId !== 'string' || connectionId === '') return null;

    // Re-read the limit on every acquire (overlay-spec §2): a live capacity
    // change widens or narrows an existing gate without recreating it.
    const limit = capacityOf(connectionId);
    const gated = Number.isInteger(limit) && limit > 0;
    if (gated && countOf(connectionId) >= limit) {
      refusals.set(connectionId, { held: countOf(connectionId), cap: limit, retryAfterMs: REFUSAL_RETRY_MS });
      return null;
    }

    let set = held.get(connectionId);
    if (!set) {
      set = new Set();
      held.set(connectionId, set);
    }
    seq += 1;
    // Frozen so a caller cannot repoint a live lease at another connection and
    // release someone else's slot with it. An UNGATED admission (no ceiling
    // registered, or a malformed one) is marked so the caller can print
    // LEASE.ungated with the fail-open reason (row 38) instead of mistaking
    // the admission for a gated one.
    const lease = Object.freeze({
      connectionId,
      seq,
      ...(!gated
        ? {
            ungated: true,
            why: limit === 0 ? 'capacity-unregistered' : 'capacity-malformed',
            held: countOf(connectionId) + 1,
          }
        : {}),
    });
    set.add(lease);
    return lease;
  }

  /** The last reserve refusal for `connectionId`, or null. */
  function lastRefusal(connectionId) {
    return refusals.get(connectionId) ?? null;
  }

  /**
   * Give the slot back. IDEMPOTENT: the second and every later call for the
   * same lease is a no-op returning false, and a lease this registry never
   * issued (a fabricated object, or one from another registry) frees nothing.
   *
   * @returns {boolean} true only for the call that actually freed a slot.
   */
  function release(lease) {
    if (!lease || typeof lease !== 'object') return false;
    const set = held.get(lease.connectionId);
    if (!set) return false;
    const freed = set.delete(lease);
    if (freed && set.size === 0) held.delete(lease.connectionId);
    return freed;
  }

  /** Open leases on one connection, or across every connection when called bare. */
  function inFlight(connectionId) {
    if (connectionId === undefined) {
      let total = 0;
      for (const set of held.values()) total += set.size;
      return total;
    }
    return countOf(connectionId);
  }

  /** Plain counts by connection id. Connections at zero are absent, so an
   *  empty object is the "no leaked lease" assertion in one comparison. */
  function snapshot() {
    const out = {};
    for (const [id, set] of held) if (set.size > 0) out[id] = set.size;
    return out;
  }

  return { reserve, release, inFlight, snapshot, lastRefusal };
}
