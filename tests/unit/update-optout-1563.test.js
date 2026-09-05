import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Issue #1563, halves 2 and 3: `npm i -g tokenproxy@0.4.62` installs the pinned
// version and the install then pushes straight back off it, and the version it
// pushes to is whatever npm's `latest` says rather than anything the user
// chose. Both halves are the same defect — the dist-tag of the published
// package was the only authority, with no way for an install to decline — and
// it has two consumers, the banner (/api/version) and the installer that
// actually replaces the binary (/api/version/update), so honouring an opt-out
// in one and not the other would still leave the install replaceable.
// (Half 1 of that report, "Claude Cowork option is completely absent", covered
// the removed CLI-tools surface and went with it.)

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');

const httpsGet = vi.fn(() => {
  const req = {
    on(event, cb) {
      // Fail the lookup asynchronously so the handler resolves instead of hanging.
      if (event === 'error') setTimeout(cb, 0);
      return req;
    },
    destroy() {},
  };
  return req;
});
vi.mock('https', () => ({
  default: { get: (...a) => httpsGet(...a) },
  get: (...a) => httpsGet(...a),
}));

let prevFlag;
let prevNodeEnv;
beforeEach(() => {
  prevFlag = process.env.TOKENPROXY_NO_UPDATE;
  prevNodeEnv = process.env.NODE_ENV;
  delete globalThis.__npmVersionCache;
  httpsGet.mockClear();
});
afterEach(() => {
  if (prevFlag === undefined) delete process.env.TOKENPROXY_NO_UPDATE;
  else process.env.TOKENPROXY_NO_UPDATE = prevFlag;
  process.env.NODE_ENV = prevNodeEnv;
});

describe('a pinned install can decline the npm latest it rolled back from (#1563)', () => {
  it('isUpdateDisabled reads the flag, and an off-ish value is not opting out', async () => {
    const { isUpdateDisabled } = await import('@/lib/appUpdater.js');
    delete process.env.TOKENPROXY_NO_UPDATE;
    expect(isUpdateDisabled()).toBe(false);
    for (const off of ['', '0', 'false']) {
      process.env.TOKENPROXY_NO_UPDATE = off;
      expect(isUpdateDisabled()).toBe(false);
    }
    for (const on of ['1', 'true', 'yes']) {
      process.env.TOKENPROXY_NO_UPDATE = on;
      expect(isUpdateDisabled()).toBe(true);
    }
  });

  it('/api/version reports no update and never reaches the registry', async () => {
    process.env.TOKENPROXY_NO_UPDATE = '1';
    const { GET } = await import('@/app/api/version/route.js');
    const body = await (await GET()).json();

    expect(body.hasUpdate).toBe(false);
    expect(body.latestVersion).toBeNull();
    expect(body.currentVersion).toBeTruthy();
    expect(httpsGet).not.toHaveBeenCalled();
  });

  it('without the flag the same handler still looks the version up', async () => {
    delete process.env.TOKENPROXY_NO_UPDATE;
    const { GET } = await import('@/app/api/version/route.js');
    await (await GET()).json();
    expect(httpsGet).toHaveBeenCalledTimes(1);
  });

  it('/api/version/update refuses to install rather than trusting the hidden banner', async () => {
    process.env.NODE_ENV = 'production';
    process.env.TOKENPROXY_NO_UPDATE = '1';
    const { POST } = await import('@/app/api/version/update/route.js');
    const res = await POST();

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toContain('TOKENPROXY_NO_UPDATE');
  });

  it("the launcher's own check honours the same flag", () => {
    // cli/ is a separate published package with no import path into src/, so
    // the contract is the variable name; assert the launcher reads it.
    const cli = readFileSync(resolve(ROOT, 'cli/cli.js'), 'utf8');
    const check = cli.slice(cli.indexOf('function checkForUpdate'));
    expect(check.slice(0, 600)).toContain('TOKENPROXY_NO_UPDATE');
  });
});
