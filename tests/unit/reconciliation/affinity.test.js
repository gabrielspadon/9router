import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// G4 / Account Scheduling Contract rule 4 (RECONCILIATION.md:99): a client
// session is pinned to one account, that pin survives a process restart, and
// healthy accounts are never round-robined.
//
// This drives a REAL SQLite file in a temp directory, because the claim under
// test is durability. A Map kept alive between assertions would pass a restart
// test that proves nothing: the point is that the row is on disk and a fresh
// adapter reads it back.
//
// Fake clock. Every timestamp below is derived from NOW and nothing sleeps.
const NOW = Date.parse('2026-01-01T00:00:00.000Z');
const HOUR = 3_600_000;
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();
const at = (offsetMs) => new Date(NOW + offsetMs);

// SYNTHETIC session hash — an obviously fake constant, never read from the
// environment or any config file, and never a raw session identity (rule 8).
const SESSION = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
const MODEL = 'anthropic/claude-sonnet-4';

const originalDataDir = process.env.DATA_DIR;
let tempDir;

// Open the database that lives in tempDir and hand back the repos bound to it.
// Called more than once per test on purpose: the second call is the restart.
async function openDb() {
  delete global._dbAdapter;
  vi.resetModules();
  process.env.DATA_DIR = tempDir;
  const { getAdapter } = await import('@/lib/db/driver.js');
  const adapter = await getAdapter();
  return {
    adapter,
    affinity: await import('@/lib/db/repos/sessionAffinityRepo.js'),
    windows: await import('@/lib/db/repos/quotaWindowsRepo.js'),
    switches: await import('@/lib/db/repos/accountSwitchRepo.js'),
  };
}

// The restart. Close the handle, drop the memoized adapter, reset the module
// registry so every repo re-imports against a new driver, and re-open the same
// file. Nothing but the file crosses this boundary.
async function restart(db) {
  try {
    db.adapter.close?.();
  } catch {}
  delete global._dbAdapter;
  vi.resetModules();
  return openDb();
}

async function freshDb() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenproxy-affinity-'));
  return openDb();
}

afterEach(() => {
  try {
    global._dbAdapter?.instance?.close?.();
  } catch {}
  delete global._dbAdapter;
  vi.resetModules();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe('durable session affinity survives a process restart', () => {
  it('reads the pin back from the file after the adapter is dropped and re-opened', async () => {
    let db = await freshDb();
    await db.affinity.setPin(SESSION, MODEL, 'conn-one', {
      providerNode: 'node-a',
      now: at(0),
    });
    expect(await db.affinity.getPin(SESSION, MODEL, { now: at(0) })).toMatchObject({
      connectionId: 'conn-one',
      providerNode: 'node-a',
    });

    db = await restart(db);

    // Same file, new adapter, freshly imported repo module.
    const after = await db.affinity.getPin(SESSION, MODEL, { now: at(HOUR) });
    expect(after).toMatchObject({ connectionId: 'conn-one', providerNode: 'node-a' });
    expect(after.pinnedAt).toBe(iso(0));
  });

  it('writes an actual row to disk, not process state', async () => {
    let db = await freshDb();
    await db.affinity.setPin(SESSION, MODEL, 'conn-one', { now: at(0) });
    const dbFile = path.join(tempDir, 'db', 'data.sqlite');
    expect(fs.existsSync(dbFile)).toBe(true);

    db = await restart(db);
    const row = db.adapter.get(
      `SELECT connectionId, pinnedAt, lastSeenAt FROM sessionAffinity WHERE sessionHash = ? AND model = ?`,
      [SESSION, MODEL]
    );
    expect(row).toMatchObject({ connectionId: 'conn-one', pinnedAt: iso(0) });
  });

  it('carries the quota evidence across the restart too, so ranking is not re-derived blind', async () => {
    let db = await freshDb();
    await db.windows.putWindows('conn-one', [
      {
        scope: 'session (5h)',
        remaining: 120,
        limit: 300,
        resetAt: iso(5 * HOUR),
        observedAt: iso(0),
        confidence: 'fresh',
      },
    ]);

    db = await restart(db);
    const all = await db.windows.getAllWindows();
    expect(all.get('conn-one')).toEqual([
      {
        scope: 'session (5h)',
        remaining: 120,
        limit: 300,
        resetAt: iso(5 * HOUR),
        observedAt: iso(0),
        confidence: 'fresh',
      },
    ]);
  });

  it('keeps pins for different models on the same session independent', async () => {
    let db = await freshDb();
    await db.affinity.setPin(SESSION, MODEL, 'conn-one', { now: at(0) });
    await db.affinity.setPin(SESSION, 'openai/gpt-5', 'conn-two', { now: at(0) });

    db = await restart(db);
    expect((await db.affinity.getPin(SESSION, MODEL, { now: at(0) })).connectionId).toBe('conn-one');
    expect(
      (await db.affinity.getPin(SESSION, 'openai/gpt-5', { now: at(0) })).connectionId
    ).toBe('conn-two');
  });

  it('drops an expired pin on read, and after a restart, rather than routing to a lapsed lease', async () => {
    let db = await freshDb();
    await db.affinity.setPin(SESSION, MODEL, 'conn-one', {
      now: at(0),
      expiresAt: iso(HOUR),
    });
    expect(await db.affinity.getPin(SESSION, MODEL, { now: at(30 * 60_000) })).not.toBeNull();

    db = await restart(db);
    expect(await db.affinity.getPin(SESSION, MODEL, { now: at(2 * HOUR) })).toBeNull();
    expect(await db.affinity.sweepExpired(iso(2 * HOUR))).toBe(1);
  });

  it('leaves a NULL-TTL pin alone when the sweep runs', async () => {
    const db = await freshDb();
    await db.affinity.setPin(SESSION, MODEL, 'conn-one', { now: at(0) });
    expect(await db.affinity.sweepExpired(iso(365 * 24 * HOUR))).toBe(0);
    expect(await db.affinity.getPin(SESSION, MODEL, { now: at(365 * 24 * HOUR) })).not.toBeNull();
  });
});

describe('affinity never round-robins between healthy accounts', () => {
  it('returns the same connection for N sequential reads and records no switch', async () => {
    const db = await freshDb();
    await db.affinity.setPin(SESSION, MODEL, 'conn-one', { now: at(0) });

    const seen = new Set();
    for (let i = 0; i < 25; i += 1) {
      const pin = await db.affinity.getPin(SESSION, MODEL, { now: at(i * 60_000) });
      seen.add(pin.connectionId);
      // A live session touches its pin on every request. That must not move it.
      await db.affinity.touchPin(SESSION, MODEL, { now: at(i * 60_000) });
    }
    expect([...seen]).toEqual(['conn-one']);

    // The second half of "never round-robins": no switch receipt exists, so
    // nothing moved silently between the reads either.
    expect(await db.switches.listSwitches({ sessionHash: SESSION })).toEqual([]);
  });

  it('holds the same connection across a restart in the middle of the sequence', async () => {
    let db = await freshDb();
    await db.affinity.setPin(SESSION, MODEL, 'conn-one', { now: at(0) });

    const seen = new Set();
    for (let i = 0; i < 20; i += 1) {
      if (i === 10) db = await restart(db);
      seen.add((await db.affinity.getPin(SESSION, MODEL, { now: at(i * 60_000) })).connectionId);
    }
    expect([...seen]).toEqual(['conn-one']);
    expect(await db.switches.listSwitches({ sessionHash: SESSION })).toEqual([]);
  });

  it('touchPin moves lastSeenAt and never pinnedAt', async () => {
    // pinnedAt is the age of the BINDING. If a touch moved it, every active
    // session would look permanently new and rule 5's restore baseline (which
    // is read from pinnedAt) would never see anything as restored.
    const db = await freshDb();
    await db.affinity.setPin(SESSION, MODEL, 'conn-one', { now: at(0) });
    expect(await db.affinity.touchPin(SESSION, MODEL, { now: at(3 * HOUR) })).toBe(1);

    const row = db.adapter.get(
      `SELECT pinnedAt, lastSeenAt FROM sessionAffinity WHERE sessionHash = ? AND model = ?`,
      [SESSION, MODEL]
    );
    expect(row.pinnedAt).toBe(iso(0));
    expect(row.lastSeenAt).toBe(iso(3 * HOUR));
  });

  it('a repin replaces the one row and restamps pinnedAt, never creating a second', async () => {
    let db = await freshDb();
    await db.affinity.setPin(SESSION, MODEL, 'conn-one', { now: at(0) });
    await db.affinity.setPin(SESSION, MODEL, 'conn-two', { now: at(2 * HOUR) });

    db = await restart(db);
    const rows = db.adapter.all(
      `SELECT connectionId, pinnedAt FROM sessionAffinity WHERE sessionHash = ? AND model = ?`,
      [SESSION, MODEL]
    );
    expect(rows).toEqual([{ connectionId: 'conn-two', pinnedAt: iso(2 * HOUR) }]);
  });

  it('drain releases every session on one account in one pass and leaves the others', async () => {
    const db = await freshDb();
    await db.affinity.setPin('sha256:aaa', MODEL, 'conn-one', { now: at(0) });
    await db.affinity.setPin('sha256:bbb', MODEL, 'conn-one', { now: at(0) });
    await db.affinity.setPin('sha256:ccc', MODEL, 'conn-two', { now: at(0) });

    expect(await db.affinity.clearPinsForConnection('conn-one')).toBe(2);
    expect(await db.affinity.getPin('sha256:aaa', MODEL, { now: at(0) })).toBeNull();
    expect((await db.affinity.getPin('sha256:ccc', MODEL, { now: at(0) })).connectionId).toBe(
      'conn-two'
    );
  });

  it('a switch that does happen leaves a durable receipt naming both sides', async () => {
    let db = await freshDb();
    const receipt = await db.switches.recordSwitch({
      sessionHash: SESSION,
      model: MODEL,
      fromConnectionId: 'conn-one',
      toConnectionId: 'conn-two',
      trigger: 'exhaustion',
      reason: 'pinned-window-exhausted',
      windows: {
        'conn-one': [{ scope: 'session (5h)', remaining: 0, limit: 300, resetAt: iso(5 * HOUR) }],
        'conn-two': [{ scope: 'session (5h)', remaining: 300, limit: 300, resetAt: iso(6 * HOUR) }],
      },
      switchedAt: iso(HOUR),
    });
    expect(receipt.id).toBeTruthy();

    db = await restart(db);
    const listed = await db.switches.listSwitches({ sessionHash: SESSION });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      fromConnectionId: 'conn-one',
      toConnectionId: 'conn-two',
      trigger: 'exhaustion',
      switchedAt: iso(HOUR),
    });
    expect(listed[0].windows['conn-one'][0].remaining).toBe(0);

    // Either side of the move is findable, which is what a drain audit asks.
    expect(await db.switches.listSwitches({ connectionId: 'conn-one' })).toHaveLength(1);
    expect(await db.switches.listSwitches({ connectionId: 'conn-nine' })).toEqual([]);
  });

  it('lists receipts newest first', async () => {
    const db = await freshDb();
    for (const [i, to] of ['conn-two', 'conn-three', 'conn-four'].entries()) {
      await db.switches.recordSwitch({
        sessionHash: SESSION,
        model: MODEL,
        fromConnectionId: 'conn-one',
        toConnectionId: to,
        trigger: 'reset',
        switchedAt: iso((i + 1) * HOUR),
      });
    }
    expect(
      (await db.switches.listSwitches({ sessionHash: SESSION })).map((r) => r.toConnectionId)
    ).toEqual(['conn-four', 'conn-three', 'conn-two']);
  });
});
