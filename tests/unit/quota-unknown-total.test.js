import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import QuotaTable from '@/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaTable.js';
import {
  calculatePercentage,
  getRemainingPercentage,
} from '@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js';
import QuotaProgressBar from '@/app/(dashboard)/dashboard/usage/components/ProviderLimits/QuotaProgressBar.js';
import { NOT_COMPUTABLE } from '@/shared/utils/measure.js';

const render = (quotas) =>
  renderToStaticMarkup(createElement(QuotaTable, { quotas }))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

describe('an unknown total yields no percentage', () => {
  it('calculatePercentage says it cannot rather than returning zero', () => {
    expect(calculatePercentage(40, 0)).toBeNull();
    expect(calculatePercentage(40, null)).toBeNull();
    expect(calculatePercentage(40, undefined)).toBeNull();
    // A real total still computes, including a real zero remaining.
    expect(calculatePercentage(100, 100)).toBe(0);
    expect(calculatePercentage(30, 100)).toBe(70);
  });

  it('getRemainingPercentage propagates it instead of rounding null to 0', () => {
    expect(getRemainingPercentage({ used: 40, total: 0 })).toBeNull();
    expect(getRemainingPercentage({ remaining: 0 })).toBe(0);
  });

  it('renders n/a beside the infinite total, never 0%', () => {
    const out = render([{ name: 'requests', used: 40, total: 0 }]);
    expect(out).toContain(NOT_COMPUTABLE);
    expect(out).not.toMatch(/\b0%/);
  });

  it('keeps a genuinely exhausted quota at 0%', () => {
    const out = render([{ name: 'requests', used: 100, total: 100 }]);
    expect(out).toContain('0%');
    expect(out).not.toContain(NOT_COMPUTABLE);
  });
});

describe('the bands are named as what they are', () => {
  it('does not present a locally derived band as an upstream health verdict', () => {
    const out = render([
      { name: 'high', used: 5, total: 100 },
      { name: 'mid', used: 60, total: 100 },
      { name: 'low', used: 95, total: 100 },
      { name: 'unknown', used: 3, total: 0 },
    ]);
    expect(out).not.toMatch(/\bHealthy\b/);
    expect(out).not.toMatch(/\bCritical\b/);
  });

  it('says once, in the panel, where the bands come from', () => {
    const out = render([{ name: 'requests', used: 5, total: 100 }]);
    expect(out).toMatch(/local threshold/i);
    expect(out).toMatch(/remaining/i);
  });

  it("still reports each row's remaining share", () => {
    const out = render([{ name: 'requests', used: 30, total: 100 }]);
    expect(out).toContain('70%');
    expect(out).toContain('requests');
  });
});

describe('the progress bar reads the same way as the table', () => {
  const bar = (props) =>
    renderToStaticMarkup(createElement(QuotaProgressBar, { label: 'requests', ...props }))
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');

  it('shows n/a rather than 0% when the share could not be computed', () => {
    const out = bar({ percentage: null, used: 40, total: 0, unlimited: true });
    expect(out).toContain(NOT_COMPUTABLE);
    expect(out).not.toMatch(/\b0%/);
  });

  it('keeps a measured share and drops the health verdict', () => {
    const out = bar({ percentage: 70, used: 30, total: 100 });
    expect(out).toContain('70%');
    expect(out).not.toMatch(/\bHealthy\b/);
    expect(out).not.toMatch(/\bCritical\b/);
  });
});
