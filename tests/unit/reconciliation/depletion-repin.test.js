import { describe, it, expect } from 'vitest';
import { decideRepin, TRIGGERS } from '@/shared/utils/repinPolicy.js';
import { rankAccounts, selectAccount } from '@/shared/utils/quotaRanking.js';

// G3 / Account Scheduling Contract rules 4 and 5 (RECONCILIATION.md:99-100):
// exhaust account one, then two, use three; then reset two and return to two,
// reset one and return to one.
//
// Fake clock throughout. Nothing reads Date.now() and nothing sleeps, so
// "account two reset" is expressed the only way the running system can know it:
// the clock passes that window's resetAt. quotaRanking's eligibility already
// treats `resetAt <= now` as replenished, which is the mechanism rule 5 rides.
//
// A DEPLETED account is `remaining: 0`. An account whose remaining equals its
// limit is untouched and is the most usable account there is.
const NOW = Date.parse('2026-01-01T00:00:00.000Z');
const HOUR = 3_600_000;
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();

const w = (scope, remaining, limit, resetAt, confidence = 'fresh') => ({
  scope,
  remaining,
  limit,
  resetAt,
  observedAt: iso(0),
  confidence,
});

const LIMIT = 300;
// One shared window shape across the cohort. A differing shape trips the cohort
// gate and no ranking runs at all, which would make every case below vacuous.
const acct = (id, priority, remaining, resetOffsetMs) => ({
  id,
  priority,
  windows: [w('session (5h)', remaining, LIMIT, iso(resetOffsetMs))],
});

// Operator-declared order: one, then two, then three. Rule 5's "earliest
// restored account" is this order, not the ranker's urgency order — rule 3
// fixes the ranker on expiring entitlement and demotes priority to a tie-break,
// so the two orderings are deliberately allowed to disagree.
const one = (remaining, resetOffsetMs) => acct('one', 1, remaining, resetOffsetMs);
const two = (remaining, resetOffsetMs) => acct('two', 2, remaining, resetOffsetMs);
const three = (remaining, resetOffsetMs) => acct('three', 3, remaining, resetOffsetMs);

// The timeline every case below is a snapshot of. Reset offsets are chosen so
// account two's window rolls over BEFORE account one's, which is the only way
// "reset two first, then reset one" is expressible with a real clock.
const ALL_FRESH = [one(LIMIT, 5 * HOUR), two(LIMIT, 6 * HOUR), three(LIMIT, 7 * HOUR)];
const ONE_SPENT = [one(0, 5 * HOUR), two(LIMIT, 6 * HOUR), three(LIMIT, 7 * HOUR)];
const ONE_TWO_SPENT = [one(0, 5 * HOUR), two(0, 6 * HOUR), three(LIMIT, 7 * HOUR)];
// Account two's 6h window has rolled over; account one's now runs to 8h and has
// not. Two is restored, one is still depleted.
const TWO_RESTORED = [one(0, 8 * HOUR), two(0, 6 * HOUR), three(200, 7 * HOUR)];
// Account one's window has now rolled over too, while two is live on a fresh
// 11h window it has been spending.
const ONE_RESTORED = [one(0, 8 * HOUR), two(150, 11 * HOUR), three(200, 7 * HOUR)];

describe('sequential depletion: one, then two, then three', () => {
  it('pins an unpinned session to the ranker winner and calls it the initial pin', () => {
    expect(selectAccount(ALL_FRESH, { now: NOW })).toBe('one');
    expect(decideRepin({ pin: null, accounts: ALL_FRESH, now: NOW })).toMatchObject({
      action: 'repin',
      from: null,
      connectionId: 'one',
      trigger: TRIGGERS.INITIAL_PIN,
    });
  });

  it('holds account one for every request while one has headroom', () => {
    // The failure this guards is round-robin: the same healthy pin must survive
    // repeated decisions, not rotate through the cohort.
    const pin = { connectionId: 'one', pinnedAt: iso(0) };
    const seen = new Set();
    for (let i = 0; i < 10; i += 1) {
      const accounts = [one(LIMIT - i * 10, 5 * HOUR), two(LIMIT, 6 * HOUR), three(LIMIT, 7 * HOUR)];
      const d = decideRepin({ pin, accounts, now: NOW + i * 60_000 });
      expect(d.action).toBe('keep');
      seen.add(d.connectionId);
    }
    expect([...seen]).toEqual(['one']);
  });

  it('moves to account two only once one is exhausted, and names exhaustion', () => {
    const at = NOW + HOUR;
    expect(rankAccounts(ONE_SPENT, { now: at }).eligible.map((r) => r.id)).toEqual(['two', 'three']);
    expect(
      decideRepin({ pin: { connectionId: 'one', pinnedAt: iso(0) }, accounts: ONE_SPENT, now: at })
    ).toMatchObject({
      action: 'repin',
      from: 'one',
      connectionId: 'two',
      trigger: TRIGGERS.EXHAUSTION,
    });
  });

  it('moves to account three only once one AND two are exhausted', () => {
    const at = NOW + 2 * HOUR;
    expect(selectAccount(ONE_TWO_SPENT, { now: at })).toBe('three');
    expect(
      decideRepin({
        pin: { connectionId: 'two', pinnedAt: iso(HOUR) },
        accounts: ONE_TWO_SPENT,
        now: at,
      })
    ).toMatchObject({
      action: 'repin',
      from: 'two',
      connectionId: 'three',
      trigger: TRIGGERS.EXHAUSTION,
    });
  });

  it('stays on three while one and two are still depleted', () => {
    const accounts = [one(0, 5 * HOUR), two(0, 6 * HOUR), three(200, 7 * HOUR)];
    const d = decideRepin({
      pin: { connectionId: 'three', pinnedAt: iso(2 * HOUR) },
      accounts,
      now: NOW + 3 * HOUR,
    });
    expect(d.action).toBe('keep');
    expect(d.connectionId).toBe('three');
  });

  it('keeps the pin rather than spraying when every account is depleted', () => {
    const d = decideRepin({
      pin: { connectionId: 'three', pinnedAt: iso(2 * HOUR) },
      accounts: [one(0, 5 * HOUR), two(0, 6 * HOUR), three(0, 7 * HOUR)],
      now: NOW + 3 * HOUR,
    });
    expect(d.action).toBe('keep');
    expect(d.reason).toMatch(/cohort-all-depleted/);
  });
});

describe('reset-aware repin: return to the earliest restored account', () => {
  it('returns to two when two resets while the session is on three', () => {
    const at = NOW + 6.5 * HOUR;
    // Two is eligible now only because its reset has passed; it was NOT
    // eligible when the pin was made. One is still depleted at this clock.
    expect(rankAccounts(TWO_RESTORED, { now: at }).eligible.map((r) => r.id)).toEqual([
      'two',
      'three',
    ]);
    expect(
      rankAccounts(TWO_RESTORED, { now: NOW + 2 * HOUR }).eligible.map((r) => r.id)
    ).toEqual(['three']);

    expect(
      decideRepin({
        pin: { connectionId: 'three', pinnedAt: iso(2 * HOUR) },
        accounts: TWO_RESTORED,
        now: at,
      })
    ).toMatchObject({
      action: 'repin',
      from: 'three',
      connectionId: 'two',
      trigger: TRIGGERS.RESET,
      reason: 'earlier-account-restored',
    });
  });

  it('returns to one when one resets next, taking the earliest restored account', () => {
    const at = NOW + 8.5 * HOUR;
    expect(
      decideRepin({
        pin: { connectionId: 'two', pinnedAt: iso(6.5 * HOUR) },
        accounts: ONE_RESTORED,
        now: at,
      })
    ).toMatchObject({
      action: 'repin',
      from: 'two',
      connectionId: 'one',
      trigger: TRIGGERS.RESET,
    });
  });

  it('repins once per restore, then holds on the same evidence', () => {
    const first = decideRepin({
      pin: { connectionId: 'three', pinnedAt: iso(2 * HOUR) },
      accounts: TWO_RESTORED,
      now: NOW + 6.5 * HOUR,
    });
    expect(first.connectionId).toBe('two');
    // The repin restamps pinnedAt, so two is eligible in its own baseline and
    // the same snapshot cannot fire a second move.
    const pin = { connectionId: 'two', pinnedAt: iso(6.5 * HOUR) };
    for (let i = 1; i <= 5; i += 1) {
      const again = decideRepin({
        pin,
        accounts: TWO_RESTORED,
        now: NOW + 6.5 * HOUR + i * 60_000,
      });
      expect(again.action).toBe('keep');
      expect(again.connectionId).toBe('two');
    }
  });

  it('never lets a LATER account pull a session off an earlier one', () => {
    // Three restores while the session sits on one. Rule 5 is a RETURN to an
    // earlier account, so a later restore is not a repin trigger at all.
    const accounts = [one(100, 13 * HOUR), two(150, 11 * HOUR), three(0, 10 * HOUR)];
    const d = decideRepin({
      pin: { connectionId: 'one', pinnedAt: iso(8.5 * HOUR) },
      accounts,
      now: NOW + 12 * HOUR,
    });
    expect(d.action).toBe('keep');
    expect(d.connectionId).toBe('one');
    expect(d.trigger).toBeNull();
  });

  it('does not repin to an earlier account that was available all along', () => {
    // One outranks three and is eligible, but nothing reset — this is the
    // anti-spray assertion, and it is what separates the policy from simply
    // calling the ranker on every request.
    expect(selectAccount(ALL_FRESH, { now: NOW + HOUR })).toBe('one');
    const d = decideRepin({
      pin: { connectionId: 'three', pinnedAt: iso(0) },
      accounts: ALL_FRESH,
      now: NOW + HOUR,
    });
    expect(d.action).toBe('keep');
    expect(d.connectionId).toBe('three');
    expect(d.reason).toBe('pin-healthy-no-earlier-restore');
  });

  it('does not move on a degraded cohort — a refusal to rank is not evidence', () => {
    // Mismatched window shapes trip the cohort gate. Rule 4's failure direction
    // is previous-pin-first, so the pin survives instead of being re-decided.
    const mismatched = [
      one(LIMIT, 5 * HOUR),
      {
        id: 'three',
        priority: 3,
        windows: [
          w('session (5h)', 200, LIMIT, iso(7 * HOUR)),
          w('weekly (7d)', 4000, 5000, iso(6 * 24 * HOUR)),
        ],
      },
    ];
    expect(rankAccounts(mismatched, { now: NOW }).degraded).toBe(true);
    const d = decideRepin({
      pin: { connectionId: 'three', pinnedAt: iso(0) },
      accounts: mismatched,
      now: NOW,
    });
    expect(d.action).toBe('keep');
    expect(d.connectionId).toBe('three');
    expect(d.reason).toMatch(/^ranking-degraded:/);
  });

  it('leaves a drained account immediately, without waiting for a reset', () => {
    const d = decideRepin({
      pin: { connectionId: 'two', pinnedAt: iso(0) },
      accounts: ALL_FRESH,
      now: NOW,
      unavailableIds: ['two'],
    });
    expect(d).toMatchObject({
      action: 'repin',
      from: 'two',
      connectionId: 'one',
      trigger: TRIGGERS.UNAVAILABLE,
    });
  });

  it('is deterministic — the same snapshot always yields the same decision', () => {
    const args = {
      pin: { connectionId: 'three', pinnedAt: iso(2 * HOUR) },
      accounts: TWO_RESTORED,
      now: NOW + 6.5 * HOUR,
    };
    const once = decideRepin(args);
    for (let i = 0; i < 5; i += 1) expect(decideRepin(args)).toEqual(once);
  });
});
