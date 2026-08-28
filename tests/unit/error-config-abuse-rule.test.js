import { describe, it, expect } from 'vitest';
import { checkFallbackError } from '../../open-sse/services/accountFallback.js';

describe('abuse-prevention backoff rule', () => {
  it("backs off with escalating level on 'to prevent abuse' error text", () => {
    const result = checkFallbackError(403, 'Request rejected to prevent abuse of the free tier');
    expect(result.shouldFallback).toBe(true);
    expect(result.newBackoffLevel).toBe(1);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });

  it('unrelated 403 text uses the plain 403 status rule, no backoff escalation', () => {
    const result = checkFallbackError(403, 'some other error entirely');
    expect(result.shouldFallback).toBe(true);
    expect(result.newBackoffLevel).toBeUndefined();
  });
});
