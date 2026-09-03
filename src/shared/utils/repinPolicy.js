/**
 * Reset-aware repin decision — Account Scheduling Contract rules 4 and 5
 * (RECONCILIATION.md), the policy layer above the ranker.
 *
 * Pure. No DB imports, no clock reads: the caller injects `now`, so a repin
 * decision is reproducible from the evidence it was made on, which is the same
 * evidence the switch receipt stores.
 *
 * src/shared/utils/quotaRanking.js is the ONLY ranking authority here. This
 * module never orders accounts itself; it asks `rankAccounts` who is eligible
 * and who ranks ahead, and adds the one thing ranking cannot express: WHETHER a
 * healthy pin should move at all.
 *
 * That distinction is the whole point. Ranking answers "which account would we
 * pick with no history", and asking it every turn is round-robin whenever the
 * evidence wobbles. Rule 4 keeps a pin until the account becomes unavailable,
 * an earlier account's quota resets, the operator drains it, or a
 * model-specific failure forces a move. So a healthy pin is surrendered only to
 * an account that RESTORED, never to one that merely edged ahead on ranking.
 *
 * "Restored" is decided by re-asking the ranker the same question at the moment
 * the pin was made: an account eligible now that was NOT eligible at `pinnedAt`
 * had a window reset while the session was living on a later account. That is
 * rule 5's trigger stated in terms of evidence rather than of remembered
 * events, which is what keeps this function pure.
 */

import { rankAccounts } from './quotaRanking.js';

// Operator-declared account order — Scheduling Contract rule 4's "a
// higher-priority account's quota resets" and rule 5's "the EARLIEST restored
// account". This is a different question from the ranker's urgency ordering,
// which rule 3 fixes as expiring-entitlement-first with priority as a
// tie-break only. Ranking answers "who should absorb load now"; this answers
// "which account does a session belong to when several are available". Sorting
// by it here is not a second ranker: eligibility and urgency both stay in
// quotaRanking.js, and nothing below ever reads a window.
function orderKeyOf(account, index) {
  const p = Number(account?.priority);
  return [Number.isFinite(p) ? p : Number.POSITIVE_INFINITY, index];
}

function earlierThan(a, b) {
  return a[0] !== b[0] ? a[0] < b[0] : a[1] < b[1];
}

// Trigger vocabulary, shared with the accountSwitches table in
// src/lib/db/schema.js so a decision and its receipt say the same word.
export const TRIGGERS = {
  INITIAL_PIN: 'initial-pin',
  EXHAUSTION: 'exhaustion',
  RESET: 'reset',
  UNAVAILABLE: 'unavailable',
};

const keep = (pin, reason) => ({
  action: 'keep',
  connectionId: pin?.connectionId ?? null,
  from: pin?.connectionId ?? null,
  trigger: null,
  reason,
});

const none = (reason) => ({
  action: 'none',
  connectionId: null,
  from: null,
  trigger: null,
  reason,
});

const move = (from, to, trigger, reason) => ({
  action: 'repin',
  connectionId: to,
  from: from ?? null,
  trigger,
  reason,
});

function toMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * Decide what happens to one session's pin.
 *
 * @param {{
 *   pin: {connectionId: string, pinnedAt?: string}|null,
 *   accounts: Array<{id: string, priority?: number, windows: Array<object>}>,
 *   now: number|Date,
 *   unavailableIds?: Iterable<string>
 * }} input
 *   `unavailableIds` carries what quota windows cannot show — a drained
 *   account, an unhealthy connection, one that just failed for this model.
 *   Those accounts leave the cohort entirely rather than being ranked and
 *   rejected, because an account that cannot serve is not failover inventory
 *   for this decision.
 * @returns {{
 *   action: 'keep'|'repin'|'none', connectionId: string|null,
 *   from: string|null, trigger: string|null, reason: string
 * }}
 *   `repin` covers the first pin too (`from` null, trigger `initial-pin`), so a
 *   caller has one write path rather than two. `none` means nothing can serve
 *   this session right now and the caller queues or fails over; it never means
 *   "silently pick something".
 */
export function decideRepin({ pin, accounts, now, unavailableIds = [] } = {}) {
  const unavailable = new Set(unavailableIds);
  const cohort = (Array.isArray(accounts) ? accounts : []).filter((a) => !unavailable.has(a?.id));
  const pinnedId = pin?.connectionId ?? null;

  if (cohort.length === 0) return none('no-accounts');

  const ranked = rankAccounts(cohort, { now, previousPinId: pinnedId });
  const winner = ranked.winner?.id ?? null;

  // Checked before the degraded gate below, because stickiness to an account
  // that has left the cohort is not stickiness, it is routing to nothing.
  const pinnedGone = pinnedId && !cohort.some((a) => a?.id === pinnedId);
  if (pinnedGone) {
    return winner
      ? move(pinnedId, winner, TRIGGERS.UNAVAILABLE, 'pinned-connection-unavailable')
      : none(ranked.reason || 'no-eligible-account');
  }

  // A degraded cohort is a refusal to rank, not evidence that some other
  // account is better. Rule 4's failure direction is previous-pin-first, and
  // moving a session on a refusal to rank is the exact spray rule 5 forbids.
  if (ranked.degraded) {
    return pinnedId ? keep(pin, `ranking-degraded:${ranked.reason}`) : none(ranked.reason);
  }
  // Past this point the cohort ranked, so at least one account is usable and
  // `winner` is non-null.

  if (!pinnedId) return move(null, winner, TRIGGERS.INITIAL_PIN, 'no-existing-pin');

  if (!ranked.eligible.some((r) => r.id === pinnedId)) {
    return move(pinnedId, winner, TRIGGERS.EXHAUSTION, 'pinned-window-exhausted');
  }

  // From here the pin is healthy, so only a restore can take it.
  const pinnedAtMs = toMs(pin?.pinnedAt);
  if (pinnedAtMs === null) return keep(pin, 'pin-healthy-no-pinned-at');

  const atPin = rankAccounts(cohort, { now: pinnedAtMs, previousPinId: pinnedId });
  // A degraded counterfactual reads as "nothing was eligible back then", which
  // would make every account look restored. Keep instead.
  if (atPin.degraded) return keep(pin, 'pin-healthy-baseline-degraded');
  const eligibleAtPin = new Set(atPin.eligible.map((r) => r.id));

  // Rule 5, stated as a filter rather than a scan: of the accounts eligible NOW
  // that were NOT eligible when this pin was made, keep only those EARLIER than
  // the pin, and return to the earliest of them. Requiring the restore is what
  // separates this from calling the ranker every turn — an earlier account that
  // was available all along never takes the pin, so a healthy session cannot
  // rotate. Requiring it to be earlier is what makes the move a return.
  const order = new Map();
  cohort.forEach((a, i) => order.set(a?.id, orderKeyOf(a, i)));
  const pinnedOrder = order.get(pinnedId);

  let target = null;
  for (const record of ranked.eligible) {
    if (record.id === pinnedId) continue;
    if (eligibleAtPin.has(record.id)) continue; // available all along, no reset
    const key = order.get(record.id);
    if (!earlierThan(key, pinnedOrder)) continue; // a LATER account never pulls
    if (target === null || earlierThan(key, order.get(target))) target = record.id;
  }
  if (target) return move(pinnedId, target, TRIGGERS.RESET, 'earlier-account-restored');

  return keep(pin, 'pin-healthy-no-earlier-restore');
}
