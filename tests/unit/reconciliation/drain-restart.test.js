import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { trackPendingRequest } from '@/lib/db/repos/usageRepo.js';

// E1.3 G5 (ai-dotfiles gates/E1.3-gateway.md) — drain finishes existing
// streams, stops new work entering the drained connection, affinity survives
// restart, rollback restores the prior release (RECONCILIATION.md's "Restart
// and drain" acceptance row).
//
// Boundary ids drain.state.entry and drain.state.exit are the legacy
// 9Router pair this admin ABI replaces (DrainController.load re-admitting no
// new work on restart while a persisted drain marker holds; the drain
// lifecycle shell command ending only once active work reaches zero).
// TokenProxy's own drain.state.entry is POST /api/admin/drain/{connectionId},
// which marks a connection draining without touching a stream already open;
// its drain.state.exit is DELETE, which records completion. Both are
// exercised below, alongside the one place a draining connection actually
// refuses new work today: POST /api/admin/qualification/{connectionId}/recheck,
// which src/lib/admin/qualification.js's route refuses outright because "a
// drain exists to let traffic leave an account, and a probe is traffic."
//
// REAL MODULES, NOT MOCKS OF THEM. @/lib/admin/state.js (backed by the real
// kv table), the drain, activation, rollback and qualification-recheck route
// handlers, and @/lib/db/repos/sessionAffinityRepo.js all run against one
// real temp-file SQLite database, restarted exactly like affinity.test.js:
// durability is the claim under test, so a mocked kv store (the way
// admin-authz.test.js mocks it for its own, unrelated, authorization claim)
// would prove nothing here. Only connection existence, the operator-credential
// collectors, and the generation probe itself (a real network call) are
// mocked.

const NOW = Date.parse('2026-01-01T00:00:00.000Z');
const HOUR = 3_600_000;
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();
const at = (offsetMs) => new Date(NOW + offsetMs);

const SESSION = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
const MODEL = 'anthropic/claude-sonnet-4';
const CONNECTION_ID = 'conn-1';
const PROBE_MODEL = 'claude-sonnet-4';

// SYNTHETIC credential material, obviously fake, never read from the
// environment. Matches admin-authz.test.js's own fixtures for the same
// routes.
const FAKE_CLI_TOKEN = 'cli-test-notreal-0000-drainrestart01';
const PEER_TOKEN = 'peer-token-fixture-notreal-drainrestart';

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  validateApiKeyLocalDb: vi.fn(),
  validateApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
  getProviderConnectionById: vi.fn(),
  getProviderConnections: vi.fn(),
  testSingleConnection: vi.fn(),
}));

vi.mock('next/server', () => ({
  NextResponse: {
    next: vi.fn(),
    json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
    redirect: vi.fn((url) => ({ status: 307, url })),
  },
}));
vi.mock('@/lib/localDb', () => ({
  getSettings: mocks.getSettings,
  validateApiKey: mocks.validateApiKeyLocalDb,
}));
vi.mock('@/lib/db/repos/apiKeysRepo.js', () => ({ validateApiKey: mocks.validateApiKey }));
vi.mock('@/shared/utils/machineId', () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));
vi.mock('@/lib/auth/dashboardSession', () => ({
  verifyDashboardAuthToken: mocks.verifyDashboardAuthToken,
}));
vi.mock('@/lib/db/repos/connectionsRepo.js', () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  getProviderConnections: mocks.getProviderConnections,
  isConnectionDegraded: () => false,
}));
vi.mock('@/app/api/providers/[id]/test/testUtils', () => ({
  testSingleConnection: mocks.testSingleConnection,
}));
vi.mock('@/lib/db/version.js', () => ({ getAppVersion: () => '0.0.1' }));

// -------------------------------------------------------------- requests
//
// Copied from admin-authz.test.js's own recipe for driving these same route
// handlers as an operator: a loopback peer presenting the CLI token that
// matches the mocked machine id. This file does not constrain identity, so
// only the one credential shape it needs is built.
function request(pathname, { method = 'GET', headers = {}, body, search = '' } = {}) {
  const url = `http://localhost${pathname}${search}`;
  return {
    method,
    url,
    nextUrl: { pathname, searchParams: new URL(url).searchParams },
    headers: new Headers(headers),
    cookies: { get: () => undefined },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

const withOperator = (pathname, opts = {}) =>
  request(pathname, {
    ...opts,
    headers: {
      'x-tp-cli-token': FAKE_CLI_TOKEN,
      'x-tp-peer-token': PEER_TOKEN,
      'x-tp-real-ip': '127.0.0.1',
      ...(opts.headers || {}),
    },
  });

const params = (connectionId) => ({ params: Promise.resolve({ connectionId }) });

// ------------------------------------------------------------- restart rig
//
// One real DATA_DIR-backed SQLite file per test, reopened exactly like
// affinity.test.js: close the handle, drop the memoized adapter, reset the
// module registry so every real import re-binds to the new adapter, then
// re-import. Nothing but the file crosses a restart.
const originalDataDir = process.env.DATA_DIR;
const originalPeerToken = process.env.TOKENPROXY_PEER_TOKEN;
let tempDir;

async function loadModules() {
  delete global._dbAdapter;
  vi.resetModules();
  process.env.DATA_DIR = tempDir;
  const { getAdapter } = await import('@/lib/db/driver.js');
  const adapter = await getAdapter();
  const affinity = await import('@/lib/db/repos/sessionAffinityRepo.js');
  const state = await import('@/lib/admin/state.js');
  const { GET: DRAIN_LIST } = await import('@/app/api/admin/drain/route.js');
  const { POST: DRAIN_ON, DELETE: DRAIN_OFF } = await import(
    '@/app/api/admin/drain/[connectionId]/route.js'
  );
  const { GET: ACTIVATION_GET, POST: ACTIVATE } = await import(
    '@/app/api/admin/activation/route.js'
  );
  const { POST: ROLLBACK } = await import('@/app/api/admin/rollback/route.js');
  const { POST: RECHECK } = await import(
    '@/app/api/admin/qualification/[connectionId]/recheck/route.js'
  );
  return {
    adapter,
    affinity,
    state,
    DRAIN_LIST,
    DRAIN_ON,
    DRAIN_OFF,
    ACTIVATION_GET,
    ACTIVATE,
    ROLLBACK,
    RECHECK,
  };
}

async function restart(db) {
  try {
    db.adapter.close?.();
  } catch {}
  delete global._dbAdapter;
  vi.resetModules();
  return loadModules();
}

async function freshDb() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenproxy-drain-restart-'));
  return loadModules();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({ requireLogin: true });
  mocks.validateApiKeyLocalDb.mockResolvedValue(false);
  mocks.validateApiKey.mockResolvedValue(false);
  mocks.getConsistentMachineId.mockResolvedValue(FAKE_CLI_TOKEN);
  mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  mocks.getProviderConnectionById.mockResolvedValue({
    id: CONNECTION_ID,
    provider: 'anthropic',
    isActive: true,
    testStatus: 'active',
  });
  mocks.getProviderConnections.mockResolvedValue([
    { id: CONNECTION_ID, provider: 'anthropic', isActive: true, testStatus: 'active' },
  ]);
  mocks.testSingleConnection.mockResolvedValue({
    valid: true,
    latencyMs: 1,
    testedAt: iso(0),
    error: null,
  });
  process.env.TOKENPROXY_PEER_TOKEN = PEER_TOKEN;
  // trackPendingRequest's in-flight counters are process-global, so every
  // test starts from a clean slate: the drain claims below read absolute
  // in-flight counts, not a delta carried over from a previous test's stream.
  if (globalThis._pendingRequests) {
    globalThis._pendingRequests.byModel = {};
    globalThis._pendingRequests.byAccount = {};
  }
});

afterEach(() => {
  // Safety net: end whatever stream a failed assertion left open, so its
  // PENDING_TIMEOUT_MS timer clears rather than outliving the test.
  trackPendingRequest(PROBE_MODEL, 'anthropic', CONNECTION_ID, false);
  try {
    global._dbAdapter?.instance?.close?.();
  } catch {
    /* the temp dir goes away regardless */
  }
  delete global._dbAdapter;
  vi.resetModules();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalPeerToken === undefined) delete process.env.TOKENPROXY_PEER_TOKEN;
  else process.env.TOKENPROXY_PEER_TOKEN = originalPeerToken;
});

describe('drain.state.entry: POST /api/admin/drain/{connectionId} finishes existing streams rather than cutting them off', () => {
  it('a stream open before the drain keeps counting through it and ends only when the stream itself does', async () => {
    const db = await freshDb();
    trackPendingRequest(PROBE_MODEL, 'anthropic', CONNECTION_ID, true);

    const entered = await db.DRAIN_ON(
      withOperator(`/api/admin/drain/${CONNECTION_ID}`, { method: 'POST' }),
      params(CONNECTION_ID)
    );
    expect(entered.status).toBe(200);
    expect(entered.body.isDraining).toBe(true);
    // drain.state.entry: admitting the drain did not touch the open stream.
    expect(entered.body.activeStreams).toBe(1);

    const midDrain = await db.DRAIN_LIST(withOperator('/api/admin/drain'));
    expect(midDrain.body.connections.find((c) => c.connectionId === CONNECTION_ID)).toMatchObject({
      isDraining: true,
      activeStreams: 1,
      completedAt: null,
    });

    // The stream finishes on its own, the way a client reading a response
    // body to the end does in chat-lease-lifecycle.test.js — nothing here
    // forces it, and nothing here has to: it is what "finishes existing
    // streams" means.
    trackPendingRequest(PROBE_MODEL, 'anthropic', CONNECTION_ID, false);

    const afterStream = await db.DRAIN_LIST(withOperator('/api/admin/drain'));
    expect(
      afterStream.body.connections.find((c) => c.connectionId === CONNECTION_ID)
    ).toMatchObject({
      isDraining: true,
      activeStreams: 0,
      completedAt: null,
    });
  });
});

describe('drain.state.exit: DELETE /api/admin/drain/{connectionId} and the new-work refusal it lifts', () => {
  it('records completion once active work has reached zero, and stops the recheck probe from spending new traffic while draining', async () => {
    const db = await freshDb();
    trackPendingRequest(PROBE_MODEL, 'anthropic', CONNECTION_ID, true);
    await db.DRAIN_ON(
      withOperator(`/api/admin/drain/${CONNECTION_ID}`, { method: 'POST' }),
      params(CONNECTION_ID)
    );

    // "stops new work entering the drained connection": a recheck probe is
    // real traffic, and the recheck route refuses it outright while draining.
    const refused = await db.RECHECK(
      withOperator(`/api/admin/qualification/${CONNECTION_ID}/recheck`, { method: 'POST' }),
      params(CONNECTION_ID)
    );
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('recheck_in_progress');
    expect(mocks.testSingleConnection).not.toHaveBeenCalled();

    trackPendingRequest(PROBE_MODEL, 'anthropic', CONNECTION_ID, false);

    const exited = await db.DRAIN_OFF(
      withOperator(`/api/admin/drain/${CONNECTION_ID}`, { method: 'DELETE' }),
      params(CONNECTION_ID)
    );
    expect(exited.status).toBe(200);
    expect(exited.body.isDraining).toBe(false);
    expect(exited.body.completedAt).toBeTruthy();

    // New work is admitted again once the drain has exited.
    const admitted = await db.RECHECK(
      withOperator(`/api/admin/qualification/${CONNECTION_ID}/recheck`, { method: 'POST' }),
      params(CONNECTION_ID)
    );
    expect(admitted.status).toBe(200);
    expect(admitted.body.generation.ok).toBe(true);
    expect(mocks.testSingleConnection).toHaveBeenCalledTimes(1);
  });
});

describe('affinity survives restart', () => {
  it('a session pin set before a restart reads back identically after the adapter is dropped and reopened', async () => {
    let db = await freshDb();
    await db.affinity.setPin(SESSION, MODEL, CONNECTION_ID, { now: at(0) });
    expect(await db.affinity.getPin(SESSION, MODEL, { now: at(0) })).toMatchObject({
      connectionId: CONNECTION_ID,
    });

    db = await restart(db);

    // Same file, new adapter, freshly imported repo module.
    const after = await db.affinity.getPin(SESSION, MODEL, { now: at(HOUR) });
    expect(after).toMatchObject({ connectionId: CONNECTION_ID });
    expect(after.pinnedAt).toBe(iso(0));
  });
});

describe('rollback restores the prior release', () => {
  it('rollback with no explicit target restores the release the last activation replaced', async () => {
    const db = await freshDb();
    // rel-1 then rel-2 activated in turn, through commitActivation — the same
    // persistence path both activation/route.js and rollback/route.js write
    // through. Seeded directly rather than via a POST /api/admin/activation
    // call because the frozen ABI has no create-release operation: a release
    // becomes a valid rollback target only by already being in history, which
    // is exactly the precondition being assumed here.
    await db.state.commitActivation(
      {
        releaseId: 'rel-1',
        version: '1.0.0',
        status: 'active',
        activatedAt: iso(0),
        previousReleaseId: null,
      },
      'activate'
    );
    await db.state.commitActivation(
      {
        releaseId: 'rel-2',
        version: '2.0.0',
        status: 'active',
        activatedAt: iso(HOUR),
        previousReleaseId: 'rel-1',
      },
      'activate'
    );

    const rolledBack = await db.ROLLBACK(withOperator('/api/admin/rollback', { method: 'POST' }));
    expect(rolledBack.status).toBe(200);
    expect(rolledBack.body.releaseId).toBe('rel-1');
    expect(rolledBack.body.previousReleaseId).toBe('rel-2');

    const state = await db.ACTIVATION_GET(withOperator('/api/admin/activation'));
    expect(state.body.active.releaseId).toBe('rel-1');
    const supersededEntry = state.body.history.find((r) => r.releaseId === 'rel-2');
    expect(supersededEntry.status).toBe('rolled_back');
  });

  it('the restored release persists across a restart, not merely process memory', async () => {
    let db = await freshDb();
    await db.state.commitActivation(
      {
        releaseId: 'rel-1',
        version: '1.0.0',
        status: 'active',
        activatedAt: iso(0),
        previousReleaseId: null,
      },
      'activate'
    );
    await db.state.commitActivation(
      {
        releaseId: 'rel-2',
        version: '2.0.0',
        status: 'active',
        activatedAt: iso(HOUR),
        previousReleaseId: 'rel-1',
      },
      'activate'
    );
    await db.ROLLBACK(withOperator('/api/admin/rollback', { method: 'POST' }));

    db = await restart(db);

    const state = await db.ACTIVATION_GET(withOperator('/api/admin/activation'));
    expect(state.body.active.releaseId).toBe('rel-1');
    expect(state.body.active.previousReleaseId).toBe('rel-2');
  });
});
