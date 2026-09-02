/**
 * #3431 GPT-5.3-Codex-Spark burns its own rate-limit windows, reported by the
 * Codex usage API beside the normal and code-review ones. Without extracting
 * them the dashboard showed a full quota while Spark was already exhausted.
 *
 * The windows ride the same prefix mechanism as `review`, so the only new work
 * is finding the Spark snapshot in the several shapes the API returns it in,
 * and giving the two resulting quota types a readable label.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const proxyAwareFetch = vi.fn();

vi.mock('../../open-sse/utils/proxyFetch.js', () => ({ proxyAwareFetch }));

const usageFor = async (payload) => {
  proxyAwareFetch.mockResolvedValue({ ok: true, json: async () => payload });
  const { getCodexUsage } = await import('../../open-sse/services/usage/codex.js');
  return getCodexUsage('token');
};

const sparkWindows = {
  primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: 1785623016 },
  secondary_window: { used_percent: 25, limit_window_seconds: 604800, reset_at: 1785678428 },
};

describe('a Spark quota response yields its windows (#3431)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('extracts spark_session and spark_weekly from a dedicated snapshot', async () => {
    const usage = await usageFor({ plan_type: 'team', spark_rate_limit: sparkWindows });

    expect(usage.quotas).toMatchObject({
      spark_session: { used: 12, remaining: 88, windowSeconds: 18000 },
      spark_weekly: { used: 25, remaining: 75, windowSeconds: 604800 },
    });
  });

  it.each([['gpt-5.3-codex-spark'], ['gpt_5_3_codex_spark'], ['spark']])(
    'finds the snapshot keyed as %s under rate_limits_by_limit_id',
    async (key) => {
      const usage = await usageFor({ rate_limits_by_limit_id: { [key]: sparkWindows } });

      expect(Object.keys(usage.quotas)).toEqual(['spark_session', 'spark_weekly']);
    }
  );

  it('finds the snapshot in the additional_rate_limits list', async () => {
    const usage = await usageFor({
      additional_rate_limits: [
        { limit_name: 'code_review', ...sparkWindows },
        { limit_name: 'gpt-5.3-codex-spark', ...sparkWindows },
      ],
    });

    expect(usage.quotas).toMatchObject({ spark_session: { used: 12 }, spark_weekly: { used: 25 } });
  });

  it('reports the Spark limit separately from the normal one', async () => {
    const usage = await usageFor({
      rate_limit: {
        limit_reached: false,
        primary_window: { used_percent: 3, limit_window_seconds: 18000 },
      },
      spark_rate_limit: { limit_reached: true, ...sparkWindows },
    });

    expect(usage).toMatchObject({ limitReached: false, sparkLimitReached: true });
    expect(Object.keys(usage.quotas)).toEqual(['session', 'spark_session', 'spark_weekly']);
  });

  it('leaves a response with no Spark snapshot untouched', async () => {
    const usage = await usageFor({
      rate_limit: { primary_window: { used_percent: 3, limit_window_seconds: 18000 } },
    });

    expect(Object.keys(usage.quotas)).toEqual(['session']);
    expect(usage.sparkLimitReached).toBe(false);
  });
});

describe('a Spark quota type renders its mapped label (#3431)', () => {
  const parse = async (quotas) => {
    const { parseQuotaData } =
      await import('../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js');
    return parseQuotaData('codex', { quotas });
  };

  it('labels the two Spark windows and keeps the raw type as modelKey', async () => {
    const quotas = await parse({
      session: { used: 7, total: 100 },
      spark_session: { used: 12, total: 100 },
      spark_weekly: { used: 25, total: 100 },
    });

    expect(quotas.map(({ name, modelKey }) => ({ name, modelKey }))).toEqual([
      { name: '5h', modelKey: 'session' },
      { name: 'Spark 5h', modelKey: 'spark_session' },
      { name: 'Spark Weekly', modelKey: 'spark_weekly' },
    ]);
  });

  it('labels a same-type second window the same way', async () => {
    const quotas = await parse({ spark_weekly: { used: 1 }, spark_weekly_secondary: { used: 2 } });

    expect(quotas.map(({ name }) => name)).toEqual(['Spark Weekly', 'Spark Weekly']);
  });

  it('still falls back to the raw type for anything unmapped', async () => {
    const quotas = await parse({ some_future_window: { used: 1 } });

    expect(quotas[0].name).toBe('some_future_window');
  });
});
