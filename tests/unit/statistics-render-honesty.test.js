import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StatisticsContent from '@/app/(dashboard)/dashboard/statistics/StatisticsContent.js';
import { NOT_COMPUTABLE, NOT_RECORDED } from '@/shared/utils/measure.js';

// Rendered text only. Class names are not the contract; what an operator reads
// on the page is.
const text = (node) =>
  renderToStaticMarkup(node)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const EMPTY_FILTERS = { providers: [], accounts: [], models: [] };

function render({ summary = {}, items = [] } = {}) {
  return text(
    createElement(StatisticsContent, {
      initialData: {
        filters: EMPTY_FILTERS,
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
          ...summary,
        },
        series: [],
        items,
        pagination: { page: 1, pageSize: 50, totalItems: items.length, totalPages: 1 },
      },
    })
  );
}

describe('summary — a rate with nothing to divide', () => {
  it('does not print 0.0% for a hit rate the backend could not compute', () => {
    const out = render();
    expect(out).toContain(`Cache Hit Rate ${NOT_COMPUTABLE}`);
    expect(out).not.toContain('Cache Hit Rate 0.0%');
  });

  it('still prints a measured zero rate as 0.0%', () => {
    const out = render({ summary: { cacheHitRate: 0, inputTokens: 3000 } });
    expect(out).toContain('Cache Hit Rate 0.0%');
  });
});

describe('summary — a latency that was never recorded', () => {
  it('says so rather than showing the same dash a measured zero would show', () => {
    const out = render();
    expect(out).toContain(`Avg Response ${NOT_RECORDED}`);
    expect(out).toContain(`Avg TTFT ${NOT_RECORDED}`);
    expect(out).not.toMatch(/Avg Response\s+-/);
  });

  it('keeps the magnitude of a sub-second average instead of collapsing it to 0.0s', () => {
    // The supplied avgLatencyMs that used to render as "AVG RESPONSE 0.0s".
    const out = render({
      summary: {
        totalRequests: 10,
        latency: {
          avgLatencyMs: 15.75,
          avgTtftMs: 4,
          latencySamples: 4,
          ttftSamples: 4,
          requests: 10,
        },
      },
    });
    expect(out).toContain('Avg Response 16ms');
    expect(out).not.toContain('0.0s');
  });
});

describe('summary — an average states its denominator', () => {
  it('prints how many of the requests actually measured the latency', () => {
    const out = render({
      summary: {
        totalRequests: 10,
        latency: {
          avgLatencyMs: 2000,
          avgTtftMs: 200,
          latencySamples: 4,
          ttftSamples: 1,
          requests: 10,
        },
      },
    });
    expect(out).toContain('Avg Response 2.0s over 4 of 10 requests');
    expect(out).toContain('Avg TTFT 200ms over 1 of 10 requests');
  });

  it('states the empty denominator too, so a missing average has a reason', () => {
    const out = render({
      summary: {
        totalRequests: 10,
        latency: {
          avgLatencyMs: null,
          avgTtftMs: null,
          latencySamples: 0,
          ttftSamples: 0,
          requests: 10,
        },
      },
    });
    expect(out).toContain(`Avg Response ${NOT_RECORDED} over 0 of 10 requests`);
  });
});

describe("request detail rows keep each absence's own reason", () => {
  const row = {
    id: 'r1',
    timestamp: '2026-08-30T10:00:00.000Z',
    provider: 'openai',
    model: 'gpt-4',
    account: 'acct',
    status: 'success',
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    reasoningTokens: 0,
    cacheHitRate: null,
    latencyMs: null,
    ttftMs: null,
  };

  it('renders an uncomputable row rate and an unrecorded row latency differently', () => {
    const out = render({ items: [row] });
    expect(out).toContain(NOT_COMPUTABLE);
    expect(out).toContain(NOT_RECORDED);
  });

  it('renders a measured row without either word', () => {
    const out = render({
      summary: {
        totalRequests: 1,
        latency: {
          avgLatencyMs: 2640,
          avgTtftMs: 300,
          latencySamples: 1,
          ttftSamples: 1,
          requests: 1,
        },
      },
      items: [
        { ...row, id: 'r2', inputTokens: 100, cacheHitRate: 0.5, latencyMs: 2640, ttftMs: 300 },
      ],
    });
    expect(out).toContain('50.0%');
    expect(out).toContain('2.6s/300ms');
    expect(out).not.toContain(NOT_RECORDED);
  });
});

describe('empty regions say what would be here', () => {
  it('uses the shared empty-state wording rather than a bare sentence', () => {
    const out = render();
    expect(out).toContain('No requests match this selection');
  });
});
