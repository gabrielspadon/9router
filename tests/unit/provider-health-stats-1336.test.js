import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// #1336 asked for measured provider response times and success rates. Capture
// already existed (requestStats carries status/latencyTotal/latencyTtft per
// request); the gap was a grouped rollup. These run real queries against a real
// SQLite file in a throwaway DATA_DIR — never ~/.tokenproxy — so the grouping and
// the honesty of an unmeasured average are exercised on the driver the app uses.

const TEMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenproxy-provider-health-'));
process.env.DATA_DIR = TEMP_DATA_DIR;

const { DATA_FILE } = await import('../../src/lib/db/paths.js');
const { getAdapter } = await import('../../src/lib/db/driver.js');
const { getProviderHealth } = await import('../../src/lib/db/repos/usageRepo.js');

const now = Date.now();
let db;

// Hard gate: DATA_DIR resolution silently falls back to ~/.tokenproxy when the
// configured directory is unusable, and this suite writes rows.
beforeAll(async () => {
  expect(DATA_FILE.startsWith(TEMP_DATA_DIR)).toBe(true);
  db = await getAdapter();
});

function insertStat(id, row = {}) {
  const {
    provider = 'openai',
    model = 'gpt-4',
    connectionId = 'conn-1',
    status = 'success',
    minutesAgo = 5,
    latencyTotal = 0,
    latencyTtft = 0,
  } = row;
  db.run(
    `INSERT INTO requestStats(id, timestamp, provider, model, connectionId, status,
       promptTokens, completionTokens, cachedTokens, cacheCreationTokens, latencyTotal, latencyTtft)
     VALUES(?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)`,
    [id, new Date(now - minutesAgo * 60000).toISOString(), provider, model, connectionId, status, latencyTotal, latencyTtft]
  );
}

describe('getProviderHealth — nothing recorded', () => {
  it('returns no rows and still states the window that produced them', async () => {
    const health = await getProviderHealth({ period: '7d' });
    expect(health.rows).toEqual([]);
    expect(health.period).toBe('7d');
    expect(health.groupBy).toBe('account');
    expect(typeof health.startDate).toBe('string');
  });
});

describe('getProviderHealth — success rate and latency per account', () => {
  beforeAll(() => {
    // Account A: 3 requests, 1 error. Two measured latency, one did not.
    insertStat('a-1', { connectionId: 'conn-a', latencyTotal: 1000, latencyTtft: 200 });
    insertStat('a-2', { connectionId: 'conn-a', latencyTotal: 3000 });
    insertStat('a-3', { connectionId: 'conn-a', status: 'error' });
    // Account B on the same provider: 1 request, clean, never measured latency.
    insertStat('b-1', { connectionId: 'conn-b' });
    // A different provider entirely, so the provider grain has two groups.
    insertStat('c-1', { provider: 'anthropic', connectionId: 'conn-c', model: 'sonnet', latencyTotal: 500 });
  });

  it('splits one provider into its accounts', async () => {
    const { rows } = await getProviderHealth({ period: '7d', groupBy: 'account' });
    const a = rows.find((r) => r.connectionId === 'conn-a');
    const b = rows.find((r) => r.connectionId === 'conn-b');
    expect(a.provider).toBe('openai');
    expect(a.requests).toBe(3);
    expect(a.errors).toBe(1);
    expect(a.successRate).toBeCloseTo(2 / 3, 10);
    expect(b.requests).toBe(1);
    expect(b.successRate).toBe(1);
  });

  it('averages only the requests that measured a latency, and says how many', async () => {
    const { rows } = await getProviderHealth({ period: '7d', groupBy: 'account' });
    const a = rows.find((r) => r.connectionId === 'conn-a');
    // 1000 and 3000 measured; the third row's 0 is absence, not an instant
    // response, so the mean is 2000 over 2 samples rather than ~1333 over 3.
    expect(a.avgLatencyMs).toBe(2000);
    expect(a.latencySamples).toBe(2);
    expect(a.avgTtftMs).toBe(200);
    expect(a.ttftSamples).toBe(1);
  });

  it('reports no average rather than an average of zero when nothing was measured', async () => {
    const { rows } = await getProviderHealth({ period: '7d', groupBy: 'account' });
    const b = rows.find((r) => r.connectionId === 'conn-b');
    expect(b.avgLatencyMs).toBeNull();
    expect(b.avgTtftMs).toBeNull();
    expect(b.latencySamples).toBe(0);
  });

  it('rolls the accounts back up at the provider grain', async () => {
    const { rows, groupBy } = await getProviderHealth({ period: '7d', groupBy: 'provider' });
    expect(groupBy).toBe('provider');
    const openai = rows.find((r) => r.provider === 'openai');
    expect(openai.requests).toBe(4);
    expect(openai.errors).toBe(1);
    expect(openai.successRate).toBeCloseTo(3 / 4, 10);
    // The provider grain carries no account identity.
    expect(openai.connectionId).toBeUndefined();
    expect(rows.some((r) => r.provider === 'anthropic')).toBe(true);
  });

  it('carries the model down to the model grain', async () => {
    const { rows } = await getProviderHealth({ period: '7d', groupBy: 'model' });
    const sonnet = rows.find((r) => r.model === 'sonnet');
    expect(sonnet.provider).toBe('anthropic');
    expect(sonnet.connectionId).toBe('conn-c');
    expect(sonnet.requests).toBe(1);
  });

  it('falls back to the account grain for an unknown groupBy rather than grouping by nothing', async () => {
    const health = await getProviderHealth({ period: '7d', groupBy: 'nonsense' });
    expect(health.groupBy).toBe('account');
    expect(health.rows.some((r) => r.connectionId === 'conn-a')).toBe(true);
  });
});

describe('getProviderHealth — the window bounds the numbers', () => {
  beforeAll(() => {
    // Well outside every trailing period below 60d.
    insertStat('old-1', { connectionId: 'conn-old', minutesAgo: 200 * 24 * 60 });
  });

  it('excludes a request older than the requested period', async () => {
    const { rows } = await getProviderHealth({ period: '24h', groupBy: 'account' });
    expect(rows.some((r) => r.connectionId === 'conn-old')).toBe(false);
  });

  it('includes it once the period is unbounded', async () => {
    const health = await getProviderHealth({ period: 'all', groupBy: 'account' });
    expect(health.startDate).toBeNull();
    expect(health.rows.some((r) => r.connectionId === 'conn-old')).toBe(true);
  });

  it('lets an explicit date range win over the period and reports itself as a range', async () => {
    const today = new Date();
    const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const health = await getProviderHealth({
      period: 'all',
      range: { startDate: key(today), endDate: key(today) },
      groupBy: 'account',
    });
    expect(health.period).toBe('range');
    expect(health.endDate).toBeTruthy();
    // The 200-day-old row is outside today, so the range excluded it even
    // though the period said "all".
    expect(health.rows.some((r) => r.connectionId === 'conn-old')).toBe(false);
  });
});
