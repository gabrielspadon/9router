import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The client reads the query string through next/navigation; the server page
// receives it as a plain object. One reader has to satisfy both.
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(globalThis.__STATS_QS__ || ''),
}));

const { readStatsQuery, initialPeriodFor } =
  await import('@/app/(dashboard)/dashboard/statistics/query.js');
const StatisticsContent = (
  await import('@/app/(dashboard)/dashboard/statistics/StatisticsContent.js')
).default;

describe('readStatsQuery reads both shapes the framework hands it', () => {
  it('reads a URLSearchParams, as the client has', () => {
    const q = readStatsQuery(new URLSearchParams('provider=openai,anthropic&model=gpt-4'));
    expect(q.provider).toEqual(['openai', 'anthropic']);
    expect(q.model).toEqual(['gpt-4']);
  });

  it('reads the plain object the server page receives, which the old .get?.() call silently skipped', () => {
    const q = readStatsQuery({ provider: 'openai,anthropic', connectionId: 'conn-1' });
    expect(q.provider).toEqual(['openai', 'anthropic']);
    expect(q.connectionId).toEqual(['conn-1']);
  });

  it('reads a repeated key, which the plain object delivers as an array', () => {
    expect(readStatsQuery({ model: ['a', 'b'] }).model).toEqual(['a', 'b']);
  });

  it('leaves an absent dimension undefined rather than an empty filter', () => {
    const q = readStatsQuery({});
    expect(q.provider).toBeUndefined();
    expect(q.connectionId).toBeUndefined();
    expect(q.model).toBeUndefined();
    expect(q.startDate).toBeUndefined();
  });

  it('normalises a date and drops one it cannot parse', () => {
    expect(readStatsQuery({ startDate: '2026-08-01T00:00:00.000Z' }).startDate).toBe(
      '2026-08-01T00:00:00.000Z'
    );
    expect(readStatsQuery({ startDate: 'not-a-date' }).startDate).toBeUndefined();
  });
});

describe('initialPeriodFor keeps the period control truthful', () => {
  it('is custom when the URL pins a range', () => {
    expect(initialPeriodFor({ startDate: '2026-08-01T00:00:00.000Z' })).toBe('custom');
  });

  it('is all when the URL pins nothing', () => {
    expect(initialPeriodFor({})).toBe('all');
  });
});

describe('the filter chips report the filter that was applied', () => {
  const initialData = {
    filters: {
      providers: [
        { id: 'openai', name: 'OpenAI' },
        { id: 'anthropic', name: 'Anthropic' },
      ],
      accounts: [],
      models: [],
    },
    summary: {
      totalRequests: 0,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      cacheHitRate: null,
      latency: {
        avgLatencyMs: null,
        avgTtftMs: null,
        latencySamples: 0,
        ttftSamples: 0,
        requests: 0,
      },
    },
    series: [],
    items: [],
    pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 0 },
  };

  const render = () =>
    renderToStaticMarkup(createElement(StatisticsContent, { initialData }))
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');

  it('does not say All providers while the URL asked for one', () => {
    globalThis.__STATS_QS__ = 'provider=openai';
    const out = render();
    expect(out).toContain('1 Provider selected');
    expect(out).not.toContain('All providers');
  });

  it('says All providers when the URL asked for none', () => {
    globalThis.__STATS_QS__ = '';
    expect(render()).toContain('All providers');
  });
});
