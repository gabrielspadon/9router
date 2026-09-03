import { describe, it, expect } from 'vitest';
import { buildSwitchReceipt, RECEIPT_KEYS } from '@/shared/utils/switchReceipt.js';
import { createLeaseRegistry } from '@/shared/utils/accountLease.js';
import { effectiveCapacity } from '@/shared/utils/accountCapacity.js';
import { selectAndReserve } from '@/sse/services/accountScheduler.js';

// G8 / Account Scheduling Contract rule 8: every account switch persists old
// id, new id, normalized windows, trigger, model, session hash and timestamp,
// and stores nothing secret and no prompt body.
//
// Fake clock. No test reads Date.now() and none sleeps.
const NOW = Date.parse('2026-01-01T00:00:00.000Z');
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

// SYNTHETIC, obviously-fake secret fixtures. Nothing here is read from the
// environment or from any config file. Each is planted somewhere in the
// scheduler's inputs, and the leak assertion is that none survives into the
// receipt's serialized JSON.
const FAKE = {
  token: 'sk-NOT-A-REAL-TOKEN-000000000000000000',
  refresh: 'refresh-NOT-REAL-111111111111111111',
  apiKey: 'AKIA-EXAMPLE-NOT-REAL-2222222222',
  cookie: 'session=NOT-REAL-COOKIE-3333333333',
  password: 'hunter2-not-a-real-password',
  prompt: 'PROMPT BODY: summarize this confidential customer record verbatim',
  rawSession: 'raw-client-session-id-not-a-hash-444444',
};

// A connection record shaped the way a real one is: the id the receipt needs,
// buried in a pile of things the receipt must never take.
const loadedConnection = (id) => ({
  id,
  provider: 'anthropic',
  maxConcurrent: 4,
  accessToken: FAKE.token,
  refreshToken: FAKE.refresh,
  apiKey: FAKE.apiKey,
  headers: { cookie: FAKE.cookie },
  auth: { password: FAKE.password },
  lastPrompt: FAKE.prompt,
  windows: [w('session (5h)', 120, 300, iso(HOUR)), w('weekly (7d)', 4000, 5000, iso(6 * DAY))],
});

const windowsWithJunk = () => [
  // Extra fields a provider payload realistically carries alongside the window
  // vocabulary. None belongs in a receipt.
  {
    ...w('session (5h)', 120, 300, iso(HOUR)),
    rawResponse: FAKE.prompt,
    authorization: `Bearer ${FAKE.token}`,
  },
  { ...w('weekly (7d)', 4000, 5000, iso(6 * DAY)), setCookie: FAKE.cookie },
  // A scoped sub-quota, which quotaRanking classifies out of general ranking.
  { scope: 'per-model opus', remaining: 5, limit: 10, resetAt: iso(HOUR) },
];

describe('buildSwitchReceipt: the exact field set rule 8 requires', () => {
  it('carries every required field and NOTHING else', () => {
    const receipt = buildSwitchReceipt({
      from: 'conn-old',
      to: 'conn-new',
      windows: [w('session (5h)', 40, 300, iso(HOUR))],
      trigger: 'exhausted',
      model: 'claude-sonnet-4',
      sessionHash: 'sha256:abc123',
      now: NOW,
    });

    // The EXACT key set, not "contains these keys". A later field addition
    // that leaks fails here rather than shipping quietly.
    expect(Object.keys(receipt).sort()).toEqual([...RECEIPT_KEYS].sort());
    expect(RECEIPT_KEYS).toHaveLength(7);
    expect(receipt.fromConnectionId).toBe('conn-old');
    expect(receipt.toConnectionId).toBe('conn-new');
    expect(receipt.trigger).toBe('exhausted');
    expect(receipt.model).toBe('claude-sonnet-4');
    expect(receipt.sessionHash).toBe('sha256:abc123');
    expect(receipt.at).toBe('2026-01-01T00:00:00.000Z');
    expect(Array.isArray(receipt.windows)).toBe(true);
  });

  it('pins each window to the normalized vocabulary and nothing more', () => {
    const receipt = buildSwitchReceipt({
      from: 'a',
      to: 'b',
      windows: windowsWithJunk(),
      trigger: 'repin',
      model: 'm',
      sessionHash: 'h',
      now: NOW,
    });
    // Longest horizon first, exactly as quotaRanking normalizes it — the
    // receipt records the evidence the decision was made from, not a second
    // rendering of it.
    expect(receipt.windows.map((x) => x.scope)).toEqual(['weekly (7d)', 'session (5h)']);
    for (const window of receipt.windows) {
      expect(Object.keys(window).sort()).toEqual([
        'confidence',
        'limit',
        'remaining',
        'resetAt',
        'scope',
      ]);
    }
    expect(receipt.windows[1]).toEqual({
      scope: 'session (5h)',
      remaining: 120,
      limit: 300,
      resetAt: iso(HOUR),
      confidence: 'fresh',
    });
  });

  it('records a first pin as a switch from nothing rather than dropping it', () => {
    const receipt = buildSwitchReceipt({
      from: null,
      to: 'conn-a',
      windows: [w('session (5h)', 10, 300, iso(HOUR))],
      trigger: 'first-pin',
      model: 'm',
      sessionHash: 'h',
      now: NOW,
    });
    expect(receipt.fromConnectionId).toBeNull();
    expect(receipt.toConnectionId).toBe('conn-a');
    expect(Object.keys(receipt).sort()).toEqual([...RECEIPT_KEYS].sort());
  });

  it('takes only the id from a full connection record handed in as from/to', () => {
    const receipt = buildSwitchReceipt({
      from: loadedConnection('old'),
      to: loadedConnection('new'),
      windows: windowsWithJunk(),
      trigger: 'drain',
      model: 'm',
      sessionHash: 'h',
      now: NOW,
    });
    expect(receipt.fromConnectionId).toBe('old');
    expect(receipt.toConnectionId).toBe('new');
    expect(typeof receipt.fromConnectionId).toBe('string');
  });

  it('stores an empty window list for unrankable evidence, never raw passthrough', () => {
    const receipt = buildSwitchReceipt({
      from: 'a',
      to: 'b',
      windows: [{ scope: 'gibberish', remaining: 1, limit: 2, secret: FAKE.token }],
      trigger: 'model-failure',
      model: 'm',
      sessionHash: 'h',
      now: NOW,
    });
    expect(receipt.windows).toEqual([]);
    expect(JSON.stringify(receipt)).not.toContain(FAKE.token);
  });

  it('normalizes the timestamp to ISO-8601 UTC from a number or a Date', () => {
    const fromNumber = buildSwitchReceipt({
      from: 'a',
      to: 'b',
      windows: [],
      trigger: 't',
      model: 'm',
      sessionHash: 'h',
      now: NOW,
    });
    const fromDate = buildSwitchReceipt({
      from: 'a',
      to: 'b',
      windows: [],
      trigger: 't',
      model: 'm',
      sessionHash: 'h',
      now: new Date(NOW),
    });
    expect(fromNumber.at).toBe(fromDate.at);
    expect(fromNumber.at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('refuses to run without an injected clock', () => {
    expect(() =>
      buildSwitchReceipt({
        from: 'a',
        to: 'b',
        windows: [],
        trigger: 't',
        model: 'm',
        sessionHash: 'h',
      })
    ).toThrow(/injected/);
  });
});

describe('buildSwitchReceipt: no secret and no prompt body survives', () => {
  it('leaks none of the synthetic secrets planted across every input', () => {
    const receipt = buildSwitchReceipt({
      from: loadedConnection('old'),
      to: loadedConnection('new'),
      windows: windowsWithJunk(),
      trigger: 'exhausted',
      model: 'claude-sonnet-4',
      sessionHash: 'sha256:0f0f0f',
      now: NOW,
    });
    const serialized = JSON.stringify(receipt);
    for (const [name, secret] of Object.entries(FAKE)) {
      expect(serialized, `receipt leaked ${name}`).not.toContain(secret);
    }
    // And no key that even NAMES a secret is present.
    expect(serialized).not.toMatch(/token|apiKey|password|cookie|authorization|prompt/i);
  });

  it('stores the session HASH and never the raw session identity', () => {
    const receipt = buildSwitchReceipt({
      from: 'a',
      to: 'b',
      windows: [],
      trigger: 't',
      model: 'm',
      sessionHash: 'sha256:deadbeef',
      now: NOW,
    });
    expect(receipt.sessionHash).toBe('sha256:deadbeef');
    expect(JSON.stringify(receipt)).not.toContain(FAKE.rawSession);
  });

  it('cannot be widened by a hostile extra input key', () => {
    // A caller passing more than the contract asks for must not be able to
    // widen the receipt: the builder picks by name, it never spreads.
    const receipt = buildSwitchReceipt({
      from: 'a',
      to: 'b',
      windows: [],
      trigger: 't',
      model: 'm',
      sessionHash: 'h',
      now: NOW,
      accessToken: FAKE.token,
      promptBody: FAKE.prompt,
    });
    expect(Object.keys(receipt).sort()).toEqual([...RECEIPT_KEYS].sort());
    expect(JSON.stringify(receipt)).not.toContain(FAKE.token);
    expect(JSON.stringify(receipt)).not.toContain(FAKE.prompt);
  });
});

describe('selectAndReserve: a receipt is persisted for every switch', () => {
  function fakeRepos() {
    const pins = new Map();
    const switches = [];
    const key = (sessionHash, model) => `${sessionHash} ${model}`;
    return {
      switches,
      transaction: (fn) => fn(),
      getPin: ({ sessionHash, model }) => pins.get(key(sessionHash, model)) ?? null,
      setPin: ({ sessionHash, model, connectionId, at }) =>
        pins.set(key(sessionHash, model), { connectionId, at }),
      recordSwitch: (r) => switches.push(r),
    };
  }

  const registryFor = (accounts) =>
    createLeaseRegistry({
      capacityOf: (id) => effectiveCapacity(accounts.find((a) => a.id === id) ?? null).limit,
    });

  it('records the first pin and then the repin, each with the full field set', () => {
    // Turn 1 pins the session to `a`: its 5h window resets soonest, so it
    // carries the entitlement about to be wasted. Turn 2 runs after `a` has
    // exhausted that window (remaining: 0 — the only way this suite spells
    // depleted), which is rule 5's "move to the next eligible account" and is
    // the switch this module owns. Reset-aware return-to-earliest is
    // repinPolicy.js's half of rule 5, not the scheduler's.
    const a = loadedConnection('a');
    const b = {
      ...loadedConnection('b'),
      windows: [
        w('session (5h)', 200, 300, iso(4 * HOUR)),
        w('weekly (7d)', 4000, 5000, iso(6 * DAY)),
      ],
    };
    const accounts = [a, b];
    const repos = fakeRepos();
    const registry = registryFor(accounts);

    const first = selectAndReserve({
      sessionHash: 'sha256:sess',
      model: 'claude-sonnet-4',
      accounts,
      windows: {},
      now: NOW,
      registry,
      repos,
    });
    expect(first.connection.id).toBe('a');
    expect(first.receipt.fromConnectionId).toBeNull();
    expect(first.receipt.toConnectionId).toBe('a');
    registry.release(first.lease);

    // `a` has now burned its 5h window down to zero. The pin can no longer
    // hold, so the session moves to `b` and the switch earns a receipt.
    const exhausted = [{ ...a, windows: [w('session (5h)', 0, 300, iso(HOUR)), a.windows[1]] }, b];
    const later = NOW + 30 * 60_000;
    const second = selectAndReserve({
      sessionHash: 'sha256:sess',
      model: 'claude-sonnet-4',
      accounts: exhausted,
      windows: {},
      now: later,
      registry,
      repos,
    });
    expect(second.connection.id).toBe('b');
    expect(second.reason).toBe('repin');
    expect(second.receipt.fromConnectionId).toBe('a');
    expect(second.receipt.toConnectionId).toBe('b');
    expect(second.receipt.at).toBe(new Date(later).toISOString());
    registry.release(second.lease);

    expect(repos.switches).toHaveLength(2);
    for (const receipt of repos.switches) {
      expect(Object.keys(receipt).sort()).toEqual([...RECEIPT_KEYS].sort());
      expect(receipt.model).toBe('claude-sonnet-4');
      expect(receipt.sessionHash).toBe('sha256:sess');
      expect(receipt.trigger).toBeTruthy();
      const serialized = JSON.stringify(receipt);
      for (const [name, secret] of Object.entries(FAKE)) {
        expect(serialized, `persisted receipt leaked ${name}`).not.toContain(secret);
      }
    }
    expect(registry.inFlight()).toBe(0);
  });

  it('writes no receipt when the session stays on its pinned account', () => {
    const accounts = [loadedConnection('a'), loadedConnection('b')];
    const repos = fakeRepos();
    const registry = registryFor(accounts);
    const call = () =>
      selectAndReserve({
        sessionHash: 'h',
        model: 'm',
        accounts,
        windows: {},
        now: NOW,
        registry,
        repos,
      });

    registry.release(call().lease);
    registry.release(call().lease);
    registry.release(call().lease);
    expect(repos.switches).toHaveLength(1); // the first pin only
  });

  it('records the normalized windows of the account it switched TO', () => {
    const accounts = [loadedConnection('a')];
    const repos = fakeRepos();
    const registry = registryFor(accounts);
    const res = selectAndReserve({
      sessionHash: 'h',
      model: 'm',
      accounts,
      windows: {},
      now: NOW,
      registry,
      repos,
    });
    expect(res.receipt.windows.map((x) => x.scope)).toEqual(['weekly (7d)', 'session (5h)']);
    expect(res.receipt.windows[0].remaining).toBe(4000);
    registry.release(res.lease);
  });
});
