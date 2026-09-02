/**
 * #1611 — "add the option to add providers by token json Antigravity", with the
 * two shapes the report pastes:
 *
 *   {"refresh_token":"1//0gAbCdEf..."}
 *   [{"refresh_token":"1//0gTokenA..."},{"refreshToken":"1//0gTokenB..."}]
 *
 * The provider-agnostic importer added for #1329 already owns this job, so no
 * Antigravity-specific route exists. What it could not read was this exact
 * paste: snake_case keys, and no `provider`/`authType`, because the person
 * pasting has already chosen both. The wrapper now carries them for the list
 * and every item inherits them.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const created = [];
vi.mock('@/models', () => ({
  createProviderConnection: vi.fn(async (data) => {
    created.push(data);
    return { id: `id-${created.length}`, provider: data.provider };
  }),
}));

const { POST, normalizeImportItem } = await import('@/app/api/providers/import/route.js');

const req = (body) => ({ json: async () => body });

beforeEach(() => {
  created.length = 0;
});

describe('#1611 pasted Antigravity token JSON imports', () => {
  it("takes the report's single-object paste", async () => {
    const res = await POST(
      req({
        provider: 'antigravity',
        accounts: [{ refresh_token: '1//0gAbCdEf' }],
      })
    );

    expect(await res.json()).toMatchObject({ success: 1, failed: 0 });
    expect(created[0]).toMatchObject({
      provider: 'antigravity',
      // Nothing named an auth type; a refresh token can only be the oauth one.
      authType: 'oauth',
      refreshToken: '1//0gAbCdEf',
      isActive: true,
    });
  });

  it("takes the report's array paste, mixing both key spellings", async () => {
    const res = await POST(
      req({
        provider: 'antigravity',
        accounts: [{ refresh_token: '1//0gTokenA' }, { refreshToken: '1//0gTokenB' }],
      })
    );

    expect(await res.json()).toMatchObject({ success: 2, failed: 0 });
    expect(created.map((c) => c.refreshToken)).toEqual(['1//0gTokenA', '1//0gTokenB']);
    expect(created.every((c) => c.provider === 'antigravity')).toBe(true);
  });

  it('never echoes a pasted token back', async () => {
    const res = await POST(
      req({
        provider: 'antigravity',
        accounts: [{ refresh_token: '1//0gSecret' }],
      })
    );
    expect(JSON.stringify(await res.json())).not.toContain('1//0gSecret');
  });

  it("lets an item override the list's provider rather than being forced into it", () => {
    const item = normalizeImportItem(
      { provider: 'codex', refresh_token: 'sk-refresh' },
      { provider: 'antigravity' }
    );
    expect(item.provider).toBe('codex');
  });

  it('infers apikey from a pasted key and access_token from a bare bearer', () => {
    expect(normalizeImportItem({ api_key: 'k' }, { provider: 'openai' }).authType).toBe('apikey');
    expect(normalizeImportItem({ access_token: 't' }, { provider: 'openai' }).authType).toBe(
      'access_token'
    );
  });

  it('still refuses a paste with no credential, and one with no provider to inherit', () => {
    expect(() => normalizeImportItem({ email: 'a@b.c' }, { provider: 'antigravity' })).toThrow(
      /No credential/
    );
    expect(() => normalizeImportItem({ refresh_token: '1//0g' }, {})).toThrow(/Unknown provider/);
  });

  it('folds the other snake_case fields the same way', () => {
    const item = normalizeImportItem(
      {
        refresh_token: 'r',
        access_token: 'a',
        id_token: 'i',
        expires_at: '2030-01-01T00:00:00.000Z',
        default_model: 'm',
        display_name: 'n',
      },
      { provider: 'antigravity' }
    );
    expect(item).toMatchObject({
      refreshToken: 'r',
      accessToken: 'a',
      idToken: 'i',
      expiresAt: '2030-01-01T00:00:00.000Z',
      defaultModel: 'm',
      displayName: 'n',
    });
  });
});
