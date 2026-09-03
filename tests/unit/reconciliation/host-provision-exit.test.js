import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// boundary-contract.json: host.provision.exit — owner "client material
// provisioning" (originally claude/.claude/shared/bin/provision-9router-client.sh,
// an ai-dotfiles edge script out of scope here), live_gate "Mac RTX and XTX
// use matching routed client state without console exposure". TokenProxy's
// frozen admin ABI has no mint or rotate operation (G6 evidence: the operator
// token belongs to the INSTANCE, not the operator), so nothing here invents
// one. The edge's tokenproxy-provision.sh copies the already-derived token
// bytes to peer hosts over SSH; what TokenProxy itself owns, and what is
// actually testable against a real contract, is the admin authentication path
// every one of those peer-held copies is checked against: requireAdmin()
// (src/lib/admin/guard.js) -> hasValidCliToken() (src/dashboardGuard.js) ->
// getConsistentMachineId() (src/shared/utils/machineId.js), reached the same
// way every real /api/admin/* route reaches it — never by importing a private
// helper and asserting on its return value directly.
//
// Honest mapping from the contract's abstractions to what TokenProxy has:
//   - "Mac RTX and XTX use matching routed client state" -> the admission
//     decision is a pure byte-equality check against ONE instance-derived
//     value (getConsistentMachineId is deterministic over persisted
//     machine-id + secret material), so two independent readers of the same
//     provisioned files — standing in for two peer hosts holding the same
//     copied token — reach the identical operator verdict on a real admin
//     route.
//   - mutation "change sibling affinity material" -> a token derived from
//     DIFFERENT persisted material (an unsynced sibling that never received
//     the real provisioning copy) is rejected, not merely logged.
//   - mutation "print private material" -> neither a granted nor a refused
//     admin response body ever contains the token or the secret it is
//     derived from.
//   - mutation "write permissive mode" -> the secret file machineId.js
//     persists is owner-only (0600), matching the mode-600 discipline
//     tokenproxy-provision.sh's own remote write enforces.
//
// REAL requireAdmin, REAL hasValidCliToken, REAL getConsistentMachineId, REAL
// GET /api/admin/health/detail, against a REAL temp-file DATA_DIR. Only the
// dashboard-session and inference-key collectors and the DB-backed health
// checks are mocked — this boundary is about the CLI-token path, not those.
const dashboardMocks = vi.hoisted(() => ({ verifyDashboardAuthToken: vi.fn(async () => false) }));
const apiKeyMocks = vi.hoisted(() => ({ validateApiKey: vi.fn(async () => false) }));
const driverMocks = vi.hoisted(() => ({
  getAdapter: vi.fn(async () => ({ get: () => ({ ok: 1 }), driver: 'mock-sqlite' })),
}));
const connectionsMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(async () => []),
  isConnectionDegraded: vi.fn(() => false),
}));
const stateMocks = vi.hoisted(() => ({ readAllDrainDocs: vi.fn(async () => ({})) }));

vi.mock('@/lib/auth/dashboardSession', () => dashboardMocks);
vi.mock('@/lib/db/repos/apiKeysRepo.js', () => apiKeyMocks);
vi.mock('@/lib/db/driver.js', () => driverMocks);
vi.mock('@/lib/db/repos/connectionsRepo.js', () => connectionsMocks);
vi.mock('@/lib/admin/state.js', () => stateMocks);

function request(pathname, { headers = {} } = {}) {
  const url = `http://localhost${pathname}`;
  return {
    method: 'GET',
    url,
    nextUrl: { pathname, searchParams: new URL(url).searchParams },
    headers: new Headers(headers),
    cookies: { get: () => undefined },
    text: async () => '',
  };
}

const originalDataDir = process.env.DATA_DIR;
let tempDirs = [];

// Loads a fresh copy of the admin auth chain against its own DATA_DIR,
// standing in for one host's independent read of whatever token material it
// was provisioned with. Two calls with the SAME dataDir simulate two peer
// hosts that received the identical provisioned bytes; two calls with
// DIFFERENT dataDirs simulate an unsynced sibling.
async function loadInstance(dataDir) {
  vi.resetModules();
  process.env.DATA_DIR = dataDir;
  const { requireAdmin } = await import('@/lib/admin/guard.js');
  const { GET } = await import('@/app/api/admin/health/detail/route.js');
  const { getConsistentMachineId } = await import('@/shared/utils/machineId.js');
  const token = await getConsistentMachineId('tp-cli-auth');
  return { requireAdmin, GET, token };
}

function freshTempDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tokenproxy-host-provision-${label}-`));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  vi.clearAllMocks();
  dashboardMocks.verifyDashboardAuthToken.mockResolvedValue(false);
  apiKeyMocks.validateApiKey.mockResolvedValue(false);
  driverMocks.getAdapter.mockResolvedValue({ get: () => ({ ok: 1 }), driver: 'mock-sqlite' });
  connectionsMocks.getProviderConnections.mockResolvedValue([]);
  connectionsMocks.isConnectionDegraded.mockReturnValue(false);
  stateMocks.readAllDrainDocs.mockResolvedValue({});
});

afterEach(() => {
  vi.resetModules();
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

describe('host.provision.exit: two peers holding the identical provisioned token reach the identical operator verdict', () => {
  it('grants operator access on an independent read of the same persisted material, twice (mutation: none — baseline determinism the rest of this file depends on)', async () => {
    const sharedDataDir = freshTempDir('shared');

    // "Mac" — first independent process to read the provisioned files.
    const mac = await loadInstance(sharedDataDir);
    // "RTX" — a second, fully independent module load against the SAME
    // on-disk material, standing in for a peer host holding the identical
    // copied token.
    const rtx = await loadInstance(sharedDataDir);

    expect(rtx.token).toBe(mac.token);
    expect(rtx.token.length).toBeGreaterThan(0);

    const macDenial = await mac.requireAdmin(request('/api/admin/health/detail', {
      headers: { 'x-tp-cli-token': mac.token },
    }));
    const rtxDenial = await rtx.requireAdmin(request('/api/admin/health/detail', {
      headers: { 'x-tp-cli-token': rtx.token },
    }));
    expect(macDenial).toBeNull();
    expect(rtxDenial).toBeNull();
  });

  it('rejects a token derived from different, unsynced material (mutation: change sibling affinity material)', async () => {
    const dataDirA = freshTempDir('a');
    const dataDirB = freshTempDir('b');

    const hostA = await loadInstance(dataDirA);
    const hostB = await loadInstance(dataDirB);
    // Two independently-generated data dirs get two different secrets, so
    // the derived tokens must differ.
    expect(hostB.token).not.toBe(hostA.token);

    // hostA never received hostB's token (an unsynced sibling), and must not
    // be admitted as operator by presenting it.
    const denial = await hostA.requireAdmin(request('/api/admin/health/detail', {
      headers: { 'x-tp-cli-token': hostB.token },
    }));
    expect(denial).not.toBeNull();
    expect(denial.status).toBe(401);

    const body = await denial.json();
    expect(body.code).toBe('unauthorized');
    // The refusal must leave quota/drain/activation state alone — a byte
    // check is out of scope for this boundary (covered by admin-authz.test.js),
    // but the refusal itself must not have run the handler.
    expect(driverMocks.getAdapter).not.toHaveBeenCalled();
  });

  it('never echoes the token or its underlying secret in a granted or refused admin response body (mutation: print private material)', async () => {
    const dataDir = freshTempDir('exposure');
    const host = await loadInstance(dataDir);
    const secretFile = path.join(dataDir, 'auth', 'cli-secret');
    const secret = fs.readFileSync(secretFile, 'utf8').trim();

    const granted = await host.GET(request('/api/admin/health/detail', {
      headers: { 'x-tp-cli-token': host.token },
    }));
    const grantedBody = JSON.stringify(await granted.json());
    expect(grantedBody).not.toContain(host.token);
    expect(grantedBody).not.toContain(secret);

    const refused = await host.GET(request('/api/admin/health/detail', {
      headers: { 'x-tp-cli-token': 'wrong-token-obviously-not-real' },
    }));
    expect(refused.status).toBe(401);
    const refusedBody = JSON.stringify(await refused.json());
    expect(refusedBody).not.toContain(host.token);
    expect(refusedBody).not.toContain(secret);
  });

  it('persists the underlying secret owner-only, never permissive (mutation: write permissive mode)', async () => {
    const dataDir = freshTempDir('mode');
    await loadInstance(dataDir);

    const secretFile = path.join(dataDir, 'auth', 'cli-secret');
    const mode = fs.statSync(secretFile).mode & 0o777;
    expect(mode).toBe(0o600);

    const machineIdFile = path.join(dataDir, 'machine-id');
    const machineIdMode = fs.statSync(machineIdFile).mode & 0o777;
    expect(machineIdMode).toBe(0o600);
  });
});
