import { describe, expect, it } from 'vitest';
import { normalizeAccountWindows, rankAccounts } from '@/shared/utils/quotaRanking.js';
import { toRankerWindow } from '@/shared/utils/quotaWindowBridge.js';

// boundary-contract.json: evidence.state.entry — owner endpointEligible,
// live_gate "only fresh qualified endpoints appear eligible". 9Router's
// endpointEligible is a single boolean gate over a benchmark record
// (throughput, cache, tools, context). TokenProxy has no benchmark evidence
// system — its accounts are the caller's own provider connections, not
// interchangeable backends — so the equivalent decision is "does an
// account's QUOTA evidence make it usable right now", which lives in
// src/shared/utils/quotaRanking.js (rankAccounts / normalizeAccountWindows),
// with one clamp that genuinely lives one module over in
// src/shared/utils/quotaWindowBridge.js's absoluteUnits. Each of the
// contract's three mutations is reinterpreted below for that domain, stated
// explicitly rather than left implicit:
//   - "accept stale evidence" -> a 'stale'-confidence account must never
//     outrank a 'fresh' one (Scheduling Contract rule 2: unknown/stale
//     evidence stays selectable — TokenProxy does not reject it outright,
//     unlike a strict endpointEligible read — but it must never win the
//     ordering). Tested at rankAccounts' confidence-band ordering key.
//   - "accept over-cap price" -> reinterpreted as quota headroom: a raw
//     reading whose remaining exceeds its own total must be clamped to the
//     total before it becomes evidence, never passed through inflated.
//     Tested at quotaWindowBridge's absoluteUnits.
//   - "accept missing or nonpositive throughput" -> reinterpreted as a
//     window's capacity ceiling: a window with no limit, or a limit at or
//     below zero, is not usable entitlement and must not validate. Tested
//     at normalizeAccountWindows / rankAccounts.
//
// Pure functions, no DB, no mocks: both modules declare themselves pure (no
// DB imports, no clock reads), so the real implementation is exercised
// directly.
const NOW = Date.parse('2026-01-01T00:00:00.000Z');
const HOUR = 3_600_000;
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();

describe('evidence.state.entry: only fresh qualified evidence is eligible', () => {
  it('a stale-confidence account never outranks a fresh one, even with a strictly better raw reset order (mutation: accept stale evidence)', () => {
    const freshButLaterReset = {
      id: 'acct-fresh',
      windows: [
        { scope: 'session (5h)', remaining: 10, limit: 100, resetAt: iso(9 * HOUR), confidence: 'fresh' },
      ],
    };
    const staleButSoonerReset = {
      id: 'acct-stale',
      windows: [
        { scope: 'session (5h)', remaining: 90, limit: 100, resetAt: iso(1 * HOUR), confidence: 'stale' },
      ],
    };

    const { eligible, ranked } = rankAccounts([freshButLaterReset, staleButSoonerReset], { now: NOW });
    // Band (fresh vs stale) is ordering key 1, ahead of the resetAt array at
    // key 2 — so the account with the objectively sooner reset still loses
    // to the fresh one. Both stay eligible (rule 2 never takes an account
    // offline for staleness alone); only the WINNER is under test.
    expect(eligible.map((r) => r.id)).toContain('acct-fresh');
    expect(eligible.map((r) => r.id)).toContain('acct-stale');
    expect(ranked[0].id).toBe('acct-fresh');
  });

  it('clamps a raw reading whose remaining exceeds its own total, never accepting an over-cap value as evidence (mutation: accept over-cap price)', () => {
    const window = toRankerWindow(
      { key: 'session (5h)', resetAt: iso(5 * HOUR), unlimited: false },
      { total: 300, remaining: 999 },
      { observedAt: iso(0), now: NOW }
    );
    expect(window).not.toBeNull();
    expect(window.limit).toBe(300);
    // The whole point: 999 never survives into a window's remaining field.
    expect(window.remaining).toBe(300);
    expect(window.remaining).toBeLessThanOrEqual(window.limit);
  });

  it('rejects a window whose capacity ceiling is missing or nonpositive rather than treating it as usable entitlement (mutation: accept missing or nonpositive throughput)', () => {
    const zeroLimit = normalizeAccountWindows([
      { scope: 'session (5h)', remaining: 50, limit: 0, resetAt: iso(HOUR), confidence: 'fresh' },
    ]);
    expect(zeroLimit.ok).toBe(false);

    const negativeLimit = normalizeAccountWindows([
      { scope: 'session (5h)', remaining: 50, limit: -10, resetAt: iso(HOUR), confidence: 'fresh' },
    ]);
    expect(negativeLimit.ok).toBe(false);

    // Carried through to the ranker: a solo account with an invalid window
    // degrades rather than reporting itself eligible.
    const { eligible, degraded } = rankAccounts(
      [{ id: 'acct-a', windows: [{ scope: 'session (5h)', remaining: 50, limit: 0, resetAt: iso(HOUR), confidence: 'fresh' }] }],
      { now: NOW }
    );
    expect(eligible).toEqual([]);
    expect(degraded).toBe(true);
  });
});
