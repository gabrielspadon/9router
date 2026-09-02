import { describe, expect, it } from 'vitest';
import { DefaultExecutor } from 'open-sse/executors/default.js';

// Issue #1645: Cloudflare Workers AI truncates responses prematurely, forcing
// the user to prompt "continue". Root cause is documented by Cloudflare itself:
// their OpenAI-compatible endpoint defaults max_tokens to 256 when a client
// omits it (https://developers.cloudflare.com/workers-ai/platform/parameters/).
// tokenproxy's OpenAI-source clients pass straight through with no translation
// hop to fill that gap, so a client that never sets max_tokens gets Cloudflare's
// stingy default rather than tokenproxy's own DEFAULT_MAX_TOKENS behavior used
// for every other source format.
describe('cloudflare-ai default max_tokens (#1645)', () => {
  it('fills a default max_tokens when the client omits it', () => {
    const executor = new DefaultExecutor('cloudflare-ai');
    const body = {
      model: '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
      messages: [{ role: 'user', content: 'hi' }],
    };

    const transformed = executor.transformRequest(body.model, body, false, {}, 'openai');

    expect(transformed.max_tokens).toBeGreaterThan(256);
  });

  it('leaves an explicit client max_tokens untouched', () => {
    const executor = new DefaultExecutor('cloudflare-ai');
    const body = {
      model: '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 128,
    };

    const transformed = executor.transformRequest(body.model, body, false, {}, 'openai');

    expect(transformed.max_tokens).toBe(128);
  });

  it('does not inject max_tokens for other providers', () => {
    const executor = new DefaultExecutor('openai');
    const body = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    };

    const transformed = executor.transformRequest(body.model, body, false, {}, 'openai');

    expect(transformed.max_tokens).toBeUndefined();
  });
});
