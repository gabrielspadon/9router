import { describe, it, expect } from 'vitest';
import {
  resolveAccountCapacity,
  resolveProviderCeiling,
  effectiveCapacity,
  DEFAULT_ACCOUNT_CAPACITY,
  UNGATED,
} from '@/shared/utils/accountCapacity.js';

// G7 / Account Scheduling Contract rule 7: capacity is configurable PER
// CONNECTION, and a provider-wide ceiling is optional and additional — never
// the only gate.

describe('accountCapacity: per-connection capacity is configurable', () => {
  it("uses the connection's own value, so two accounts can differ by an order of magnitude", () => {
    expect(resolveAccountCapacity({ id: 'big', maxConcurrent: 64 })).toBe(64);
    expect(resolveAccountCapacity({ id: 'small', maxConcurrent: 3 })).toBe(3);
  });

  it('documents its default for a connection that configures nothing', () => {
    expect(resolveAccountCapacity({ id: 'a' })).toBe(DEFAULT_ACCOUNT_CAPACITY);
    expect(resolveAccountCapacity(null)).toBe(DEFAULT_ACCOUNT_CAPACITY);
    // overlay-spec §8 resolves 2 vs 80 in favour of 80: the acceptance contract
    // needs 80 concurrent requests to complete or wait without starvation.
    expect(DEFAULT_ACCOUNT_CAPACITY).toBe(80);
  });

  it('honours a caller-supplied default, keeping the ceiling a live knob', () => {
    expect(resolveAccountCapacity({ id: 'a' }, { defaultCapacity: 8 })).toBe(8);
  });

  it('treats an explicit 0 as deliberately ungated, not as a missing value', () => {
    expect(resolveAccountCapacity({ id: 'a', maxConcurrent: 0 })).toBe(UNGATED);
    expect(UNGATED).toBe(0);
  });

  it('still gates at a limit of 1, which is distinct from ungated', () => {
    expect(resolveAccountCapacity({ id: 'a', maxConcurrent: 1 })).toBe(1);
    expect(effectiveCapacity({ id: 'a', maxConcurrent: 1 }).gated).toBe(true);
  });

  it('fails open to the default on a malformed value rather than throttling to zero', () => {
    for (const bad of ['ten', -5, 2.5, NaN, {}]) {
      expect(resolveAccountCapacity({ id: 'a', maxConcurrent: bad })).toBe(
        DEFAULT_ACCOUNT_CAPACITY
      );
    }
  });
});

describe('accountCapacity: the provider ceiling is OPTIONAL and additional', () => {
  it('applies the per-account gate when no provider ceiling exists at all', () => {
    // The case the contract cares about: absent provider policy must not mean
    // absent gating, or per-connection capacity is decorative.
    const res = effectiveCapacity(
      { id: 'a', provider: 'anthropic', maxConcurrent: 12 },
      { settings: null }
    );
    expect(res).toEqual({ limit: 12, gated: true, source: 'account' });
  });

  it('still gates when settings exist but configure no ceiling for this provider', () => {
    const settings = { providerStrategies: { openai: { maxConcurrent: 4 } } };
    const res = effectiveCapacity(
      { id: 'a', provider: 'anthropic', maxConcurrent: 12 },
      { settings }
    );
    expect(resolveProviderCeiling(settings, 'anthropic')).toBeNull();
    expect(res).toEqual({ limit: 12, gated: true, source: 'account' });
  });

  it('lets a lower provider ceiling bound the account, as an outer safety limit', () => {
    const settings = { providerStrategies: { anthropic: { maxConcurrent: 5 } } };
    const res = effectiveCapacity(
      { id: 'a', provider: 'anthropic', maxConcurrent: 40 },
      { settings }
    );
    expect(res).toEqual({ limit: 5, gated: true, source: 'provider-ceiling' });
  });

  it('does not let a higher provider ceiling raise a deliberately small account', () => {
    const settings = { providerStrategies: { anthropic: { maxConcurrent: 500 } } };
    const res = effectiveCapacity(
      { id: 'a', provider: 'anthropic', maxConcurrent: 3 },
      { settings }
    );
    expect(res).toEqual({ limit: 3, gated: true, source: 'account' });
  });

  it('keeps the provider ceiling in force even when the account opts out of gating', () => {
    const settings = { providerStrategies: { anthropic: { maxConcurrent: 6 } } };
    const res = effectiveCapacity(
      { id: 'a', provider: 'anthropic', maxConcurrent: 0 },
      { settings }
    );
    expect(res).toEqual({ limit: 6, gated: true, source: 'provider-ceiling' });
  });

  it('is fully ungated only when the account opts out AND no ceiling is configured', () => {
    const res = effectiveCapacity(
      { id: 'a', provider: 'anthropic', maxConcurrent: 0 },
      { settings: {} }
    );
    expect(res).toEqual({ limit: UNGATED, gated: false, source: 'account-ungated' });
  });

  it('ignores a malformed provider ceiling instead of throttling on it', () => {
    for (const bad of ['4', 0, -1, 1.5]) {
      expect(
        resolveProviderCeiling(
          { providerStrategies: { anthropic: { maxConcurrent: bad } } },
          'anthropic'
        )
      ).toBeNull();
    }
    const settings = { providerStrategies: { anthropic: { maxConcurrent: '4' } } };
    expect(
      effectiveCapacity({ id: 'a', provider: 'anthropic', maxConcurrent: 9 }, { settings })
    ).toEqual({
      limit: 9,
      gated: true,
      source: 'account',
    });
  });

  it('reads the provider off the connection when the caller does not name one', () => {
    const settings = { providerStrategies: { codex: { maxConcurrent: 2 } } };
    expect(
      effectiveCapacity({ id: 'a', provider: 'codex', maxConcurrent: 50 }, { settings }).limit
    ).toBe(2);
  });

  it('names its source, so a switch receipt can record why a request queued', () => {
    const settings = { providerStrategies: { anthropic: { maxConcurrent: 2 } } };
    expect(
      effectiveCapacity({ id: 'a', provider: 'anthropic', maxConcurrent: 50 }, { settings }).source
    ).toBe('provider-ceiling');
    expect(
      effectiveCapacity({ id: 'a', provider: 'anthropic', maxConcurrent: 1 }, { settings }).source
    ).toBe('account');
  });
});
