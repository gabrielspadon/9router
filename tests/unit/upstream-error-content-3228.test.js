import { describe, it, expect } from 'vitest';

import { detectUpstreamErrorContent } from '../../open-sse/services/upstreamErrorContent.js';

// #3228: a third-party proxy fronting opencode answers a 429 with HTTP 200 and
// the rate-limit message written into the assistant content instead of a real
// non-200 status. Without a matching signature that text reads downstream as
// the model's own answer, so no fallback fires and the combo/account loop
// never tries another proxy -- exactly the "one proxy 429s, coding stops"
// report. checkFallbackError (accountFallback.js) already rotates correctly
// on a genuine non-200 429; this closes the same gap for the 200-wrapped case,
// same mechanism as the Codex/NaraRouter/CommandCode/qoder signatures already
// caught here (#3232 #3242 #3468 #3636 #1996).
describe('a 200-wrapped rate-limit blurb is detected as an upstream error (#3228)', () => {
  it("catches a plain 'rate limit exceeded' blurb", () => {
    const r = detectUpstreamErrorContent('Rate limit exceeded. Please try again in a few seconds.');
    expect(r).toBeTruthy();
    expect(r.retryable).toBe(true);
  });

  it("catches a plain 'too many requests' blurb", () => {
    const r = detectUpstreamErrorContent('Too many requests, please slow down.');
    expect(r).toBeTruthy();
    expect(r.retryable).toBe(true);
  });

  it('does not fire on a real answer that merely discusses rate limits at length', () => {
    const essay =
      'Rate limit exceeded is a common HTTP 429 message. ' +
      'A well-behaved client backs off and retries with jitter rather than hammering the endpoint. '.repeat(
        4
      );
    expect(essay.length).toBeGreaterThan(300);
    expect(detectUpstreamErrorContent(essay)).toBe(null);
  });

  it('does not fire on ordinary short answers', () => {
    for (const t of ['42', 'Yes.', 'The capital of France is Paris.']) {
      expect(detectUpstreamErrorContent(t), t).toBe(null);
    }
  });
});
