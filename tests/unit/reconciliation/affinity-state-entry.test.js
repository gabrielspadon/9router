import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// boundary-contract.json: affinity.state.entry — owner AffinityLedger.load,
// live_gate "resumed conversation keeps exact model endpoint account and
// connection". TokenProxy's own equivalent of the LOAD boundary is the read
// side of durable session affinity: src/lib/db/repos/sessionAffinityRepo.js's
// getPin, keyed by (sessionHash, model) the same way AffinityLedger.load is
// keyed by a session/model tuple, and always resolved from the real on-disk
// row rather than a live in-process decision. affinity.test.js already
// exercises this repo broadly; this file is scoped to the three LOAD-time
// failure modes the contract names, which affinity.test.js does not carry the
// boundary id for. The durability-across-restart half of the claim
// (fifteen identities, second turn, restart) is affinity.state.exit, in
// affinity-state-exit.test.js — this file never restarts the process.
//
// Mutations this file must fail under if reintroduced:
//   - "accept changed connection tuple": getPin resolves the wrong model's
//     connection for a session pinned under several models at once
//     (sessionAffinityRepo.js's SQL match key, sessionHash AND model).
//   - "accept changed account tuple": the providerNode recorded at pin time
//     is dropped or substituted on read rather than returned exactly
//     (rowToPin's providerNode mapping).
//   - "reuse malformed identity": a row keyed by a falsy/empty session
//     identity — one that never should have been pinned through setPin,
//     which applies the identical guard — is resolved and reused anyway on
//     read (getPin's own `if (!sessionHash || !model) return null;` guard).
//
// REAL MODULES, NOT MOCKS. A real temp-file SQLite database, opened exactly
// like affinity.test.js: a getPin that is faked cannot prove anything about
// what sessionAffinityRepo.js itself returns.
const NOW = Date.parse('2026-01-01T00:00:00.000Z');
const HOUR = 3_600_000;
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();
const at = (offsetMs) => new Date(NOW + offsetMs);

// SYNTHETIC session hash — an obviously fake constant, never read from the
// environment or any config file, and never a raw session identity.
const SESSION = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
const MODEL_A = 'anthropic/claude-sonnet-4';
const MODEL_B = 'openai/gpt-5';

const originalDataDir = process.env.DATA_DIR;
let tempDir;

async function openDb() {
  delete global._dbAdapter;
  vi.resetModules();
  process.env.DATA_DIR = tempDir;
  const { getAdapter } = await import('@/lib/db/driver.js');
  const adapter = await getAdapter();
  return { adapter, affinity: await import('@/lib/db/repos/sessionAffinityRepo.js') };
}

async function freshDb() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenproxy-affinity-entry-'));
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

describe('affinity.state.entry: resumed conversation keeps exact model endpoint account and connection', () => {
  it("loads the exact connection pinned under THIS model, not a sibling model's connection on the same session (mutation: accept changed connection tuple)", async () => {
    const db = await freshDb();
    await db.affinity.setPin(SESSION, MODEL_A, 'conn-one', { now: at(0) });
    await db.affinity.setPin(SESSION, MODEL_B, 'conn-two', { now: at(0) });

    // Both reads must independently resolve to their own tuple. A load that
    // ignored the model half of the key would collapse these two answers into
    // whichever row an unconstrained scan happens to return first — the
    // failure this asserts against, either row picked wrong.
    const resumedA = await db.affinity.getPin(SESSION, MODEL_A, { now: at(HOUR) });
    const resumedB = await db.affinity.getPin(SESSION, MODEL_B, { now: at(HOUR) });
    expect(resumedA.connectionId).toBe('conn-one');
    expect(resumedB.connectionId).toBe('conn-two');
  });

  it('loads the exact providerNode recorded at pin time, never substituting or dropping it (mutation: accept changed account tuple)', async () => {
    const db = await freshDb();
    await db.affinity.setPin(SESSION, MODEL_A, 'conn-one', {
      providerNode: 'node-primary-77',
      now: at(0),
    });

    const resumed = await db.affinity.getPin(SESSION, MODEL_A, { now: at(HOUR) });
    expect(resumed.connectionId).toBe('conn-one');
    expect(resumed.providerNode).toBe('node-primary-77');
  });

  it('never resolves a pin for a malformed (empty-string) session identity, even when a row for it exists on disk (mutation: reuse malformed identity)', async () => {
    const db = await freshDb();
    // Simulates a malformed identity that reached the table through some path
    // other than setPin, which applies this exact guard itself and would
    // never have written the row in the first place — e.g. a row surviving
    // from before a validation fix. The LOAD boundary has to refuse it
    // regardless of how it got there, not merely rely on the write boundary
    // never producing it.
    db.adapter.run(
      `INSERT INTO sessionAffinity(sessionHash, model, connectionId, providerNode, pinnedAt, expiresAt, lastSeenAt)
       VALUES(?, ?, ?, NULL, ?, NULL, ?)`,
      ['', MODEL_A, 'conn-malformed', iso(0), iso(0)]
    );

    expect(await db.affinity.getPin('', MODEL_A, { now: at(0) })).toBeNull();
  });
});
