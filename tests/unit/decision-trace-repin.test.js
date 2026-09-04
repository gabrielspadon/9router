import { describe, expect, it, vi } from 'vitest';

// decideRepin's seven outcomes, exposed for printing as
// {action, to, from, trigger, reason} (docs/logging-design.md rows 26-27 and
// step 3.2: the policy returns the verdict, auth.js prints it).
import { decideRepin, TRIGGERS } from '@/shared/utils/repinPolicy.js';

const NOW = Date.parse('2026-09-03T12:00:00.000Z');
const HOUR = 3_600_000;
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();

const w = (remaining, resetAt, confidence = 'fresh') => ({
  scope: 'session (5h)',
  remaining,
  limit: 1000,
  resetAt,
  observedAt: iso(0),
  confidence,
});
const loaded = (id, windows, extra = {}) => ({ id, priority: 0, windows, ...extra });
const healthy = () => loaded('conn_aaaaaaaa', [w(100, iso(1 * HOUR))]);
const other = () => loaded('conn_bbbbbbbb', [w(100, iso(2 * HOUR))]);
const pin = (connectionId) => ({ connectionId, pinnedAt: iso(-3 * HOUR) });

describe('decideRepin exposes trigger/reason/from/to for every outcome', () => {
  it('empty cohort -> none, no-accounts', () => {
    expect(decideRepin({ pin: null, accounts: [], now: NOW })).toEqual({
      action: 'none',
      connectionId: null,
      to: null,
      from: null,
      trigger: null,
      reason: 'no-accounts',
    });
  });

  it('pinned account left the cohort -> repin on unavailable', () => {
    const r = decideRepin({ pin: pin('conn_gone01'), accounts: [healthy(), other()], now: NOW });
    expect(r).toMatchObject({
      action: 'repin',
      from: 'conn_gone01',
      to: 'conn_aaaaaaaa',
      trigger: TRIGGERS.UNAVAILABLE,
      reason: 'pinned-connection-unavailable',
    });
  });

  it('pinned account gone and nothing can serve -> none with the ranker reason', () => {
    const depleted = loaded('conn_bbbbbbbb', [w(0, iso(2 * HOUR))]);
    const r = decideRepin({ pin: pin('conn_gone01'), accounts: [depleted], now: NOW });
    expect(r.action).toBe('none');
    expect(r.to).toBeNull();
    // A solo depleted record degrades to no winner and no reason; the policy
    // then names the exit itself.
    expect(r.reason).toBe('no-eligible-account');
  });

  it('degraded cohort with a fallback winner keeps the pin', () => {
    // Shape mismatch degrades the cohort but the fallback still orders it.
    const mismatched = loaded('conn_bbbbbbbb', [
      { scope: 'weekly (7d)', remaining: 100, limit: 1000, resetAt: iso(2 * HOUR), observedAt: iso(0), confidence: 'fresh' },
    ]);
    const r = decideRepin({ pin: pin('conn_aaaaaaaa'), accounts: [healthy(), mismatched], now: NOW });
    expect(r.action).toBe('keep');
    expect(r.to).toBe('conn_aaaaaaaa');
    expect(r.from).toBe('conn_aaaaaaaa');
    expect(r.trigger).toBeNull();
  });

  it('no existing pin -> repin with initial-pin from nothing', () => {
    const r = decideRepin({ pin: null, accounts: [healthy(), other()], now: NOW });
    expect(r).toMatchObject({
      action: 'repin',
      from: null,
      to: 'conn_aaaaaaaa',
      trigger: TRIGGERS.INITIAL_PIN,
      reason: 'no-existing-pin',
    });
  });

  it('pinned window exhausted -> repin on exhaustion (the pin-expired verdict)', () => {
    const exhausted = loaded('conn_aaaaaaaa', [w(0, iso(2 * HOUR))]);
    const r = decideRepin({ pin: pin('conn_aaaaaaaa'), accounts: [exhausted, other()], now: NOW });
    expect(r).toMatchObject({
      action: 'repin',
      from: 'conn_aaaaaaaa',
      to: 'conn_bbbbbbbb',
      trigger: TRIGGERS.EXHAUSTION,
      reason: 'pinned-window-exhausted',
    });
  });

  it('earlier account restored -> repin on reset; healthy pin otherwise keeps', () => {
    // Rule 5's input: b is EARLIER in operator order and reads as exhausted in
    // the counterfactual ranking at pinnedAt (remaining 0, reset still future
    // then) but replenished now (resetAt already elapsed) — a genuine restore,
    // not an account that was available all along. a is the LATER pinned
    // account, still healthy. The pin moves back to the earliest restored.
    const restored = loaded('conn_bbbbbbbb', [w(0, iso(-1 * HOUR))], { priority: 0 });
    const a = loaded('conn_aaaaaaaa', [w(100, iso(5 * HOUR))], { priority: 1 });
    const old = iso(-2 * HOUR);
    const moved = decideRepin({
      pin: { connectionId: 'conn_aaaaaaaa', pinnedAt: old },
      accounts: [a, restored],
      now: NOW,
    });
    expect(moved).toMatchObject({
      action: 'repin',
      from: 'conn_aaaaaaaa',
      to: 'conn_bbbbbbbb',
      trigger: TRIGGERS.RESET,
      reason: 'earlier-account-restored',
    });

    const kept = decideRepin({ pin: pin('conn_aaaaaaaa'), accounts: [healthy(), other()], now: NOW });
    expect(kept.action).toBe('keep');
    expect(kept.reason).toBe('pin-healthy-no-earlier-restore');
    expect(kept.to).toBe('conn_aaaaaaaa');
  });

  it('never prints: the policy is pure', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      decideRepin({ pin: null, accounts: [healthy()], now: NOW });
    } finally {
      spy.mockRestore();
    }
    expect(spy).not.toHaveBeenCalled();
  });
});
