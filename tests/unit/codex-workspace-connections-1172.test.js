/**
 * #796 / #1172 — one Codex account, several workspace connections.
 *
 * The two reports are the same constraint seen from opposite sides. #796 says a
 * second Codex account is accepted with a success message and then does not
 * appear in the list; #1172 asks for one connection per Codex workspace. Both
 * are decided by the dedup key in createProviderConnection: what counts as "the
 * same connection" for a codex OAuth sign-in.
 *
 * The key is (email + chatgptAccountId), and chatgptAccountId is the workspace.
 * These tests pin that it separates workspaces (so a second row is inserted
 * rather than collapsed onto the first, which is #796's silent overwrite), that
 * it still merges a genuine re-login to the SAME workspace (so two rows never
 * end up fighting over one rotating refresh token), and that the two rows are
 * distinguishable afterwards — which is #1172's actual gap, since both grants
 * carry the same email and were therefore given the same name.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const originalDataDir = process.env.DATA_DIR;
let dataDir;
let repo;

function codexLogin(overrides = {}) {
  return {
    provider: 'codex',
    authType: 'oauth',
    email: 'dev@example.test',
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    ...overrides,
  };
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'tokenproxy-codex-1172-'));
  process.env.DATA_DIR = dataDir;
  repo = await import('../../src/lib/db/repos/connectionsRepo.js');
});

afterAll(() => {
  delete global._dbAdapter;
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

beforeEach(async () => {
  for (const conn of await repo.getProviderConnections()) {
    await repo.deleteProviderConnection(conn.id);
  }
});

describe('codex workspace connections', () => {
  it('keeps a second workspace of the same account as its own connection', async () => {
    const personal = await repo.createProviderConnection(
      codexLogin({
        providerSpecificData: { chatgptAccountId: 'ws-personal-111111' },
      })
    );
    const team = await repo.createProviderConnection(
      codexLogin({
        accessToken: 'access-2',
        refreshToken: 'refresh-2',
        providerSpecificData: { chatgptAccountId: 'ws-team-222222' },
      })
    );

    expect(team.id).not.toBe(personal.id);
    const all = await repo.getProviderConnections({ provider: 'codex' });
    expect(all).toHaveLength(2);
    // The first workspace's credential is still its own — this is #796's
    // silent overwrite, which is what made the second account "not appear".
    const stored = all.find((c) => c.id === personal.id);
    expect(stored.accessToken).toBe('access-1');
    expect(stored.refreshToken).toBe('refresh-1');
  });

  it('names the two workspaces apart so connection management can tell them apart', async () => {
    const personal = await repo.createProviderConnection(
      codexLogin({
        providerSpecificData: { chatgptAccountId: 'ws-personal-111111' },
      })
    );
    const team = await repo.createProviderConnection(
      codexLogin({
        accessToken: 'access-2',
        providerSpecificData: { chatgptAccountId: 'ws-team-222222' },
      })
    );

    expect(personal.name).toBe('dev@example.test');
    expect(team.name).not.toBe(personal.name);
    expect(team.name).toContain('dev@example.test');
    expect(team.name).toContain('222222');
  });

  it('still merges a re-login to the workspace that is already connected', async () => {
    const first = await repo.createProviderConnection(
      codexLogin({
        providerSpecificData: { chatgptAccountId: 'ws-personal-111111' },
      })
    );
    const again = await repo.createProviderConnection(
      codexLogin({
        accessToken: 'access-rotated',
        refreshToken: 'refresh-rotated',
        providerSpecificData: { chatgptAccountId: 'ws-personal-111111' },
      })
    );

    expect(again.id).toBe(first.id);
    expect(await repo.getProviderConnections({ provider: 'codex' })).toHaveLength(1);
    const stored = await repo.getProviderConnectionById(first.id);
    expect(stored.accessToken).toBe('access-rotated');
    expect(stored.refreshToken).toBe('refresh-rotated');
  });

  it('does not rename a connection the caller named itself', async () => {
    await repo.createProviderConnection(
      codexLogin({
        name: 'Shared label',
        providerSpecificData: { chatgptAccountId: 'ws-personal-111111' },
      })
    );
    const second = await repo.createProviderConnection(
      codexLogin({
        name: 'Shared label',
        accessToken: 'access-2',
        providerSpecificData: { chatgptAccountId: 'ws-team-222222' },
      })
    );

    expect(second.name).toBe('Shared label');
  });
});
