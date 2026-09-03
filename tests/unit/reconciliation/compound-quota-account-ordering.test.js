import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rankAccounts } from '@/shared/utils/quotaRanking.js';

/**
 * docs/reconciliation/issues/01-compound-quota-account-ordering.md,
 * "Acceptance test" (restated in overlay-spec.md §1's own "Compound windows"
 * proof): fake-clock cases for accounts with five-hour plus seven-day,
 * seven-day-dominant, and five-hour plus seven-day plus thirty-day windows
 * select the account with the most urgent expiring usable entitlement
 * without violating any longer window.
 *
 * ADAPTED, not transcribed verbatim — two places in the issue doc predate the
 * shipped rankAccounts (quotaRanking.js) and no longer match it exactly:
 *
 *  - rankAccounts REFUSES to compare accounts whose window SHAPES differ (the
 *    cohort gate — quotaRanking.js's shapeKey check, already locked down by
 *    quota-ranking.test.js's "degrades when window shapes differ across the
 *    cohort"), rather than ranking a 5h+7d account against a literal 7d-only
 *    one. Case 1 keeps a uniform 5h+7d shape on both accounts and proves the
 *    identical point the doc names — the LONGEST window's reset time governs,
 *    even over a shorter window that resets sooner still — by making the
 *    second account's 7d window the urgent one instead of omitting its 5h
 *    window outright.
 *  - The doc's assertion shape, `rankAccounts(fixtures, { now }).map(a =>
 *    a.id)`, predates rankAccounts returning `{ranked, eligible, winner,
 *    degraded, reason}` rather than a bare array. Every assertion below reads
 *    `.ranked` or `.winner.id` off that object instead.
 *
 * Fake clock throughout, per the doc's prescribed methodology. rankAccounts
 * itself never reads the wall clock (`now` is an injected parameter), but
 * vi.useFakeTimers() removes even the possibility across this whole file.
 */
const NOW = Date.parse('2026-01-01T00:00:00.000Z');
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();

const w = (scope, remaining, limit, resetAt, confidence = 'fresh') => ({
  scope,
  remaining,
  limit,
  resetAt,
  observedAt: iso(0),
  confidence,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('compound quota account ordering (issue 01 acceptance test)', () => {
  it('case 1: soonest usable reset wins when neither account is exhausted', () => {
    // acct-5h7d's 5h window resets soonest of ANY window in the cohort (10
    // min), but ranking compares the LONGEST window first (rule 3).acct-7d-
    // urgent's 7d window resets in an hour, far sooner than acct-5h7d's
    // 3-day 7d window, so it wins despite its own 5h window being the less
    // urgent one — the doc's "soonest reset wins" point, expressed without
    // tripping the cohort's shape-match gate.
    const accounts = [
      {
        id: 'acct-5h7d',
        windows: [
          w('session (5h)', 250, 300, iso(10 * MIN)),
          w('weekly (7d)', 4500, 5000, iso(3 * DAY)),
        ],
      },
      {
        id: 'acct-7d-urgent',
        windows: [
          w('session (5h)', 250, 300, iso(4 * HOUR)),
          w('weekly (7d)', 4500, 5000, iso(1 * HOUR)),
        ],
      },
    ];
    const res = rankAccounts(accounts, { now: Date.now() });
    expect(res.degraded).toBe(false);
    expect(res.ranked.map((r) => r.id)).toEqual(['acct-7d-urgent', 'acct-5h7d']);
    expect(res.winner.id).toBe('acct-7d-urgent');
  });

  it('case 2: a constraining 30d window suppresses a sooner-resetting 5h window', () => {
    // acct-5h-fast's 5h window resets soonest of anything in the cohort (20
    // min) and its 30d window is barely touched and far from reset.
    // acct-30d-tight's 5h window resets much later, but its 30d window is
    // both nearly exhausted AND resets soon (12h) — the longest window is
    // compared first, so THAT reset time governs and the account whose short
    // window "looks" most urgent does not win, proving "without violating
    // any longer window." `remaining` on the 30d window is realistic flavor
    // (both windows stay usable — remaining > 0 either way): the mechanism
    // the ranker actually applies is reset-time primacy at the longest
    // horizon (quotaRanking.js ordering key 2), not a remaining-quantity
    // weighting.
    const accounts = [
      {
        id: 'acct-5h-fast',
        windows: [
          w('session (5h)', 280, 300, iso(20 * MIN)),
          w('weekly (7d)', 4800, 5000, iso(6 * DAY)),
          w('monthly (30d)', 85_000, 90_000, iso(25 * DAY)),
        ],
      },
      {
        id: 'acct-30d-tight',
        windows: [
          w('session (5h)', 280, 300, iso(3 * HOUR)),
          w('weekly (7d)', 4800, 5000, iso(5 * DAY)),
          w('monthly (30d)', 500, 90_000, iso(12 * HOUR)),
        ],
      },
    ];
    const res = rankAccounts(accounts, { now: Date.now() });
    expect(res.degraded).toBe(false);
    expect(res.ranked.map((r) => r.id)).toEqual(['acct-30d-tight', 'acct-5h-fast']);
    expect(res.winner.id).toBe('acct-30d-tight');
  });

  it('case 3: identical windows differ only by static priority, which is the tie-break only', () => {
    // Same array reference on both accounts: every resetAt ties exactly, so
    // the sort falls through every ordering key ahead of priority (usable,
    // confidence band, the full resetAt array, previous pin) before priority
    // ever decides anything.
    const shared = [
      w('session (5h)', 150, 300, iso(2 * HOUR)),
      w('weekly (7d)', 2500, 5000, iso(4 * DAY)),
    ];
    const accounts = [
      { id: 'acct-priority-5', priority: 5, windows: shared },
      { id: 'acct-priority-1', priority: 1, windows: shared },
    ];
    const res = rankAccounts(accounts, { now: Date.now() });
    expect(res.degraded).toBe(false);
    expect(res.ranked.map((r) => r.id)).toEqual(['acct-priority-1', 'acct-priority-5']);
    expect(res.winner.id).toBe('acct-priority-1');
  });
});
