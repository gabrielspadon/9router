import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The recent panel is rendered beside the period totals. Without a time
// predicate it showed rows from outside the selected period next to
// "Total Requests 0", so the panel contradicted the figure above it.

const TEMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenproxy-usage-period-'));
process.env.DATA_DIR = TEMP_DATA_DIR;

const { DATA_FILE } = await import('../../src/lib/db/paths.js');
const { getAdapter } = await import('../../src/lib/db/driver.js');
const { getUsageStats } = await import('../../src/lib/db/repos/usageRepo.js');

const now = Date.now();
const DAY_MS = 86400000;
let db;

beforeAll(async () => {
  expect(DATA_FILE.startsWith(TEMP_DATA_DIR)).toBe(true);
  db = await getAdapter();

  const insert = (model, at) =>
    db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint,
         promptTokens, completionTokens, cost, status, tokens, meta)
       VALUES(?, 'openai', ?, 'conn-1', 'sk-x', '/v1/chat/completions', 100, 20, 0, 'ok', ?, '{}')`,
      [
        new Date(at).toISOString(),
        model,
        JSON.stringify({ prompt_tokens: 100, completion_tokens: 20 }),
      ]
    );

  insert('fresh-model', now - 60000);
  insert('stale-model-9d', now - 9 * DAY_MS);
  insert('stale-model-45d', now - 45 * DAY_MS);
});

const models = (stats) => stats.recentRequests.map((r) => r.model);

describe('getUsageStats recent panel honours the selected period', () => {
  it("shows only today's rows for today", async () => {
    const stats = await getUsageStats('today');
    expect(models(stats)).toContain('fresh-model');
    expect(models(stats)).not.toContain('stale-model-9d');
    expect(models(stats)).not.toContain('stale-model-45d');
  });

  it("shows only the last day's rows for 24h", async () => {
    const stats = await getUsageStats('24h');
    expect(models(stats)).toEqual(['fresh-model']);
  });

  it('reaches back a week for 7d and a month for 30d', async () => {
    expect(models(await getUsageStats('7d'))).toEqual(['fresh-model']);
    const thirty = models(await getUsageStats('30d'));
    expect(thirty).toContain('fresh-model');
    expect(thirty).toContain('stale-model-9d');
    expect(thirty).not.toContain('stale-model-45d');
  });

  it('keeps every row when no period is selected', async () => {
    const all = models(await getUsageStats('all'));
    expect(all).toContain('fresh-model');
    expect(all).toContain('stale-model-45d');
  });

  it('never lists a row the period totals did not count', async () => {
    const stats = await getUsageStats('today');
    // One row today: 100 prompt tokens. The panel below must not out-count it.
    expect(stats.totalPromptTokens).toBe(100);
    expect(stats.recentRequests).toHaveLength(1);
  });
});
