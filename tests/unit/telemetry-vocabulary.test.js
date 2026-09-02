import { describe, it, expect } from 'vitest';
import {
  NOT_COMPUTABLE,
  NOT_RECORDED,
  isMeasured,
  fmtRate,
  fmtPercent,
  fmtDuration,
} from '@/shared/utils/measure.js';

// The whole point of the module: three outcomes, three renderings. A dash for
// all three is not honesty, it is a different lie.
describe('measurement vocabulary', () => {
  it('gives the two absent cases distinct words', () => {
    expect(NOT_COMPUTABLE).toBe('n/a');
    expect(NOT_RECORDED).toBe('not recorded');
    expect(NOT_COMPUTABLE).not.toBe(NOT_RECORDED);
    // and neither of them is the old catch-all dash
    expect([NOT_COMPUTABLE, NOT_RECORDED]).not.toContain('-');
  });

  it('counts a real zero as measured and nothing else', () => {
    expect(isMeasured(0)).toBe(true);
    expect(isMeasured(0.0)).toBe(true);
    expect(isMeasured(null)).toBe(false);
    expect(isMeasured(undefined)).toBe(false);
    expect(isMeasured(NaN)).toBe(false);
    expect(isMeasured(Infinity)).toBe(false);
    expect(isMeasured('12')).toBe(false);
  });
});

describe('fmtRate — a ratio whose denominator may be zero', () => {
  it('renders a measured zero rate as 0.0%', () => {
    expect(fmtRate(0)).toBe('0.0%');
  });

  it('renders an uncomputable rate as n/a, never as 0.0%', () => {
    expect(fmtRate(null)).toBe(NOT_COMPUTABLE);
    expect(fmtRate(undefined)).toBe(NOT_COMPUTABLE);
    expect(fmtRate(null)).not.toBe('0.0%');
  });

  it('renders a measured rate', () => {
    expect(fmtRate(0.4237)).toBe('42.4%');
    expect(fmtRate(1)).toBe('100.0%');
  });
});

describe('fmtPercent — a whole-percent headroom figure', () => {
  it('renders a measured zero as 0%', () => {
    expect(fmtPercent(0)).toBe('0%');
  });

  it('renders an unknown total as n/a rather than 0%', () => {
    expect(fmtPercent(null)).toBe(NOT_COMPUTABLE);
    expect(fmtPercent(null)).not.toBe('0%');
  });

  it('rounds a measured percentage', () => {
    expect(fmtPercent(66.6)).toBe('67%');
  });
});

describe('fmtDuration — a latency that may never have been measured', () => {
  it('keeps the magnitude of a sub-second duration instead of collapsing to 0.0s', () => {
    // the supplied avgLatencyMs that rendered as "AVG RESPONSE 0.0s"
    expect(fmtDuration(15.75)).toBe('16ms');
    expect(fmtDuration(49)).toBe('49ms');
    expect(fmtDuration(999)).toBe('999ms');
  });

  it('renders a never-recorded latency distinctly from a measured zero', () => {
    expect(fmtDuration(null)).toBe(NOT_RECORDED);
    expect(fmtDuration(undefined)).toBe(NOT_RECORDED);
    expect(fmtDuration(0)).toBe('0ms');
    expect(fmtDuration(0)).not.toBe(fmtDuration(null));
  });

  it('renders seconds above a second', () => {
    expect(fmtDuration(1000)).toBe('1.0s');
    expect(fmtDuration(2640)).toBe('2.6s');
  });
});
