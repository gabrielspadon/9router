// Import/export route validation + round-trip against the real DB adapter
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '9router-combos-io-'));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try {
    global._dbAdapter?.instance?.close?.();
  } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

function jsonRequest(body) {
  return { json: async () => body };
}

function jsonResponse(res) {
  return { status: res.status, body: res.body };
}

describe('combos import/export', () => {
  it('export returns version 2 payload with combos and strategies', async () => {
    const { createCombo } = await import('@/lib/db/index.js');
    const { getSettings, updateSettings } = await import('@/lib/db/index.js');
    await createCombo({ name: 'alpha', kind: 'llm', models: ['p/a', 'p/b'] });
    await updateSettings({
      comboStrategies: { alpha: { fallbackStrategy: 'fusion', judgeModel: 'p/judge' } },
    });

    const { GET } = await import('@/app/api/combos/export/route.js');
    const res = await GET();
    const data = res.json ? null : null; // NextResponse
    const body = await res.json();
    expect(body.version).toBe(2);
    expect(body.combos).toHaveLength(1);
    expect(body.combos[0]).toMatchObject({ name: 'alpha', kind: 'llm', models: ['p/a', 'p/b'] });
    expect(body.combos[0].strategy).toEqual({ fallbackStrategy: 'fusion', judgeModel: 'p/judge' });
  });

  it('import replaces combos and persists strategies', async () => {
    const { createCombo, getCombos, getSettings } = await import('@/lib/db/index.js');
    await createCombo({ name: 'old', models: ['x/1'] });

    const { POST } = await import('@/app/api/combos/import/route.js');
    const res = await POST(
      jsonRequest({
        version: 2,
        combos: [
          {
            name: 'new-1',
            kind: 'llm',
            models: ['p/a'],
            strategy: { fallbackStrategy: 'round-robin' },
          },
          { name: 'new-2', models: ['p/b'], roundRobin: true },
        ],
      })
    );
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.count).toBe(2);

    const combos = await getCombos();
    expect(combos.map((c) => c.name).sort()).toEqual(['new-1', 'new-2']);
    const strategies = (await getSettings()).comboStrategies || {};
    expect(strategies['new-1']).toEqual({ fallbackStrategy: 'round-robin' });
    expect(strategies['new-2']).toEqual({ fallbackStrategy: 'round-robin' });
    expect(strategies.old).toBeUndefined();
  });

  it('import merges capacityAdapter over existing keys', async () => {
    const { updateSettings, getSettings } = await import('@/lib/db/index.js');
    await updateSettings({
      capacityAdapter: { vision: { enabled: true, roundRobin: false, models: ['keep/me'] } },
    });

    const { POST } = await import('@/app/api/combos/import/route.js');
    const res = await POST(
      jsonRequest({
        version: 2,
        combos: [{ name: 'c', models: ['p/a'] }],
        capacityAdapter: { audioInput: { enabled: false, models: ['a/1'] } },
      })
    );
    expect(res.status).toBe(201);
    const adapter = (await getSettings()).capacityAdapter || {};
    expect(adapter.vision.models).toEqual(['keep/me']);
    expect(adapter.audioInput).toMatchObject({ enabled: false, models: ['a/1'] });
  });

  it('import rejects invalid payloads', async () => {
    const { POST } = await import('@/app/api/combos/import/route.js');

    const cases = [
      { payload: null, error: 'Invalid JSON: expected an object with version and combos' },
      {
        payload: { combos: [{ name: 'x', models: [] }] },
        error: 'Missing or invalid version field',
      },
      { payload: { version: 2, combos: 'nope' }, error: 'Combos must be an array' },
      { payload: { version: 2, combos: [] }, error: 'At least one combo is required' },
      {
        payload: { version: 2, combos: [{ name: 'bad name!', models: [] }] },
        error: 'Combo 1: name "bad name!" can only contain letters, numbers, -, _ and .',
      },
      {
        payload: {
          version: 2,
          combos: [
            { name: 'd', models: [] },
            { name: 'd', models: [] },
          ],
        },
        error: 'Combo 2: duplicate name "d"',
      },
      {
        payload: { version: 2, combos: [{ name: 'k', kind: 'nope', models: [] }] },
        error: 'Combo 1: invalid kind "nope"',
      },
      {
        payload: { version: 2, combos: [{ name: 'k', models: [] }], capacityAdapter: { nope: {} } },
        error: 'capacityAdapter: unknown capability "nope"',
      },
    ];
    for (const { payload, error } of cases) {
      const res = await POST(jsonRequest(payload));
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toBe(error);
    }
  });
});
