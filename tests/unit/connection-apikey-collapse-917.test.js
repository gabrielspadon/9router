/**
 * #917 — "Can't add account": a second API-key account is accepted with a
 * success response and then is not in the list.
 *
 * createProviderConnection deduped apikey rows on the NAME alone, and the name
 * is routinely not something the operator chose: POST /api/providers falls back
 * to the provider's display name when the form sends none
 * (src/app/api/providers/route.js). So the second key for a provider arrived
 * under the same name as the first, matched it, and was written ON TOP of it —
 * 201 Created, one row, the first account's credential gone.
 *
 * tests/unit/bulk-add-names.test.js works the same collapse around from the
 * client side by gap-filling generated names; that leaves every other caller
 * (the single-add form, the HTTP API, a script) still overwriting.
 *
 * The rule these pin: a row is the same connection only when the credential is
 * also the same. A re-save of the same key still updates in place; a different
 * key is a new account, named apart so the list can tell them from each other.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const originalDataDir = process.env.DATA_DIR;
let dataDir;
let repo;

function apiKeyAdd(overrides = {}) {
  return {
    provider: 'openrouter',
    authType: 'apikey',
    name: 'OpenRouter',
    apiKey: 'sk-first',
    isActive: true,
    ...overrides,
  };
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'tokenproxy-apikey-917-'));
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

describe('adding a second API key under the default name (#917)', () => {
  it('keeps the second key as its own connection', async () => {
    const first = await repo.createProviderConnection(apiKeyAdd());
    const second = await repo.createProviderConnection(apiKeyAdd({ apiKey: 'sk-second' }));

    expect(second.id).not.toBe(first.id);
    expect(await repo.getProviderConnections({ provider: 'openrouter' })).toHaveLength(2);
  });

  it("does not overwrite the first account's credential", async () => {
    const first = await repo.createProviderConnection(apiKeyAdd());
    await repo.createProviderConnection(apiKeyAdd({ apiKey: 'sk-second' }));

    const stored = await repo.getProviderConnectionById(first.id);
    expect(stored.apiKey).toBe('sk-first');
  });

  it('names the two apart so the list can distinguish them', async () => {
    const first = await repo.createProviderConnection(apiKeyAdd());
    const second = await repo.createProviderConnection(apiKeyAdd({ apiKey: 'sk-second' }));
    const third = await repo.createProviderConnection(apiKeyAdd({ apiKey: 'sk-third' }));

    expect(first.name).toBe('OpenRouter');
    expect(new Set([first.name, second.name, third.name]).size).toBe(3);
    expect(second.name).toContain('OpenRouter');
  });

  it('still updates in place when the same key is saved again', async () => {
    const first = await repo.createProviderConnection(apiKeyAdd());
    const again = await repo.createProviderConnection(
      apiKeyAdd({ defaultModel: 'anthropic/claude-3.5-sonnet' })
    );

    expect(again.id).toBe(first.id);
    expect(await repo.getProviderConnections({ provider: 'openrouter' })).toHaveLength(1);
    const stored = await repo.getProviderConnectionById(first.id);
    expect(stored.defaultModel).toBe('anthropic/claude-3.5-sonnet');
  });

  it('treats a credential-less compatible endpoint as one connection, not many', async () => {
    // isOpenAICompatibleProvider connections legitimately carry no key (#1523),
    // so an empty key must still match an empty key or every re-save of a local
    // gateway would pile up another row.
    const first = await repo.createProviderConnection(
      apiKeyAdd({ provider: 'openai-compatible-local', name: 'Local', apiKey: '' })
    );
    const again = await repo.createProviderConnection(
      apiKeyAdd({ provider: 'openai-compatible-local', name: 'Local', apiKey: '' })
    );

    expect(again.id).toBe(first.id);
    expect(await repo.getProviderConnections({ provider: 'openai-compatible-local' })).toHaveLength(
      1
    );
  });

  it('keys the match on the provider, not on the name alone', async () => {
    const a = await repo.createProviderConnection(apiKeyAdd({ provider: 'groq', name: 'Shared' }));
    const b = await repo.createProviderConnection(
      apiKeyAdd({ provider: 'cerebras', name: 'Shared' })
    );

    expect(b.id).not.toBe(a.id);
    expect(await repo.getProviderConnections({ provider: 'groq' })).toHaveLength(1);
    expect(await repo.getProviderConnections({ provider: 'cerebras' })).toHaveLength(1);
  });
});
