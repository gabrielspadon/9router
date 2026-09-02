import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Real read queries against a real SQLite file in a throwaway DATA_DIR — never
// ~/.tokenproxy — so the substitutions the summary makes for absent measurements
// are exercised on the driver the app actually uses.

const TEMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenproxy-stats-honesty-'));
process.env.DATA_DIR = TEMP_DATA_DIR;

const { DATA_FILE } = await import('../../src/lib/db/paths.js');
const { getAdapter } = await import('../../src/lib/db/driver.js');
const { getStatsSummary, getStatsItems } =
  await import('../../src/lib/db/repos/requestStatsRepo.js');

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
    minutesAgo = 5,
    promptTokens = 0,
    completionTokens = 0,
    cachedTokens = 0,
    cacheCreationTokens = 0,
    latencyTotal = 0,
    latencyTtft = 0,
  } = row;
  db.run(
    `INSERT INTO requestStats(id, timestamp, provider, model, connectionId, status,
       promptTokens, completionTokens, cachedTokens, cacheCreationTokens, latencyTotal, latencyTtft)
     VALUES(?, ?, 'openai', 'gpt-4', 'conn-1', 'success', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      new Date(now - minutesAgo * 60000).toISOString(),
      promptTokens,
      completionTokens,
      cachedTokens,
      cacheCreationTokens,
      latencyTotal,
      latencyTtft,
    ]
  );
}

describe('getStatsSummary — an empty selection measured nothing', () => {
  it('reports no cache hit rate rather than a rate of zero', async () => {
    const summary = await getStatsSummary({});
    expect(summary.totalRequests).toBe(0);
    // Nothing was sent, so there is no ratio. 0 would claim every request
    // missed the cache.
    expect(summary.cacheHitRate).toBeNull();
  });

  it('reports no average latency rather than an average of zero', async () => {
    const summary = await getStatsSummary({});
    expect(summary.latency.avgLatencyMs).toBeNull();
    expect(summary.latency.avgTtftMs).toBeNull();
    expect(summary.latency.latencySamples).toBe(0);
    expect(summary.latency.ttftSamples).toBe(0);
  });
});

describe('getStatsSummary — an average states its own denominator', () => {
  beforeAll(() => {
    // Three requests. Two carry a measured latency, one never recorded it.
    // Only one of the three recorded a TTFT.
    insertStat('m-1', {
      promptTokens: 100,
      completionTokens: 10,
      latencyTotal: 1000,
      latencyTtft: 200,
    });
    insertStat('m-2', {
      promptTokens: 100,
      completionTokens: 10,
      latencyTotal: 3000,
      latencyTtft: 0,
    });
    insertStat('m-3', { promptTokens: 100, completionTokens: 10, latencyTotal: 0, latencyTtft: 0 });
  });

  it('averages over the rows that measured it and says how many those were', async () => {
    const summary = await getStatsSummary({});
    expect(summary.totalRequests).toBe(3);
    // (1000 + 3000) / 2 — never (1000 + 3000 + 0) / 3, and never an average
    // silently taken over a different population than the count beside it.
    expect(summary.latency.avgLatencyMs).toBe(2000);
    expect(summary.latency.latencySamples).toBe(2);
    expect(summary.latency.avgTtftMs).toBe(200);
    expect(summary.latency.ttftSamples).toBe(1);
  });

  it('still reports no hit rate when nothing was cacheable', async () => {
    const summary = await getStatsSummary({});
    // 300 prompt tokens, none of them cached and none written: the denominator
    // is real, so a 0.0% hit rate here IS a measurement.
    expect(summary.cacheHitRate).toBe(0);
  });
});

describe('getStatsItems — per-row absences keep their own reason', () => {
  it('gives a token-free row no hit rate and no latency', async () => {
    insertStat('empty-row', { minutesAgo: 1 });
    const { items } = await getStatsItems({ page: 1, pageSize: 10 });
    const row = items.find((i) => i.id === 'empty-row');
    expect(row).toBeTruthy();
    expect(row.cacheHitRate).toBeNull();
    expect(row.latencyMs).toBeNull();
    expect(row.ttftMs).toBeNull();
  });

  it('keeps a measured zero hit rate on a row that did send tokens', async () => {
    const { items } = await getStatsItems({ page: 1, pageSize: 10 });
    const row = items.find((i) => i.id === 'm-1');
    expect(row.cacheHitRate).toBe(0);
    expect(row.latencyMs).toBe(1000);
    expect(row.ttftMs).toBe(200);
  });
});
