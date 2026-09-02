/**
 * Codex authenticates a CUSTOM model provider from env_key, http_headers,
 * env_http_headers or a token command only — auth.json is read by the built-in
 * openai provider. Writing the key solely to auth.json left every request to
 * the tokenproxy provider unauthenticated (401 Missing API key).
 *
 * The key therefore travels as a static header on the provider block. The
 * auth.json write stays: it is what a user switching back to the built-in
 * openai provider reads, and this route is the only thing that maintains it.
 *
 * The [agents.subagent] table is the fork's #1454 fix (Codex refuses a role
 * with no description). It is asserted here as well, because the upstream
 * change that introduced the header also replaced that table with a scalar,
 * and adopting that half would silently break the subagent again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseTOML } from 'confbox';

let home;

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, default: { ...actual.default, homedir: () => home } };
});

const apply = async (body) => {
  const { POST } = await import('../../src/app/api/cli-tools/codex-settings/route.js');
  const response = await POST({ json: async () => body });
  expect(response.status ?? 200).toBe(200);
  return fsp.readFile(path.join(home, '.codex', 'config.toml'), 'utf-8');
};

const settings = { baseUrl: 'http://localhost:20128', apiKey: 'sk-tp-secret', model: 'gpt-5.6' };

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenproxy-codex-auth-'));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

describe('the generated Codex config sends the API key', () => {
  it('puts an Authorization header on the tokenproxy provider block', async () => {
    const config = await apply(settings);

    expect(parseTOML(config).model_providers['tokenproxy']).toMatchObject({
      name: 'TokenProxy',
      base_url: 'http://localhost:20128/v1',
      wire_api: 'responses',
      http_headers: { Authorization: 'Bearer sk-tp-secret' },
    });
  });

  it('writes the header under the provider, not at the root', async () => {
    const config = await apply(settings);

    expect(config).toContain('[model_providers.tokenproxy.http_headers]');
    expect(parseTOML(config).http_headers).toBeUndefined();
  });

  it('rewrites the header when the key is rotated', async () => {
    await apply(settings);
    const config = await apply({ ...settings, apiKey: 'sk-tp-rotated' });

    expect(parseTOML(config).model_providers['tokenproxy'].http_headers).toEqual({
      Authorization: 'Bearer sk-tp-rotated',
    });
  });

  it('still maintains auth.json for the built-in openai provider', async () => {
    await fsp.mkdir(path.join(home, '.codex'), { recursive: true });
    const authPath = path.join(home, '.codex', 'auth.json');
    await fsp.writeFile(authPath, JSON.stringify({ tokens: { access_token: 'keep-me' } }));

    await apply(settings);

    expect(JSON.parse(await fsp.readFile(authPath, 'utf-8'))).toEqual({
      tokens: { access_token: 'keep-me' },
      OPENAI_API_KEY: 'sk-tp-secret',
      auth_mode: 'apikey',
    });
  });
});

describe('the agents subagent section survives unchanged (#1454)', () => {
  it('stays a table carrying both model and description', async () => {
    const parsed = parseTOML(await apply({ ...settings, subagentModel: 'gpt-5.6-mini' }));

    expect(parsed.agents.subagent).toEqual({
      model: 'gpt-5.6-mini',
      description: 'General-purpose subagent routed through TokenProxy.',
    });
  });

  it('is not replaced by an agents.default_subagent_model scalar', async () => {
    const config = await apply(settings);

    expect(config).not.toContain('default_subagent_model');
    expect(parseTOML(config).agents.subagent.model).toBe('gpt-5.6');
  });
});

describe("the merge leaves the rest of the user's config alone", () => {
  it('keeps unrelated providers and settings', async () => {
    await fsp.mkdir(path.join(home, '.codex'), { recursive: true });
    await fsp.writeFile(
      path.join(home, '.codex', 'config.toml'),
      'approval_policy = "on-request"\n\n[model_providers.ollama]\nname = "Ollama"\nbase_url = "http://localhost:11434/v1"\n'
    );

    const parsed = parseTOML(await apply(settings));

    expect(parsed.approval_policy).toBe('on-request');
    expect(parsed.model_providers.ollama).toMatchObject({ name: 'Ollama' });
    expect(parsed.model_providers['tokenproxy'].http_headers.Authorization).toBe(
      'Bearer sk-tp-secret'
    );
  });
});
