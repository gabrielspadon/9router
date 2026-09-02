import { describe, expect, it } from 'vitest';
import { PROVIDERS } from 'open-sse/config/providers.js';
import { resolveTransport } from 'open-sse/services/provider.js';
import { resolveUpstreamRoute } from 'open-sse/handlers/chatCore/upstreamRoute.js';

const CODING_CLAUDE = 'https://api.kimi.com/coding/v1/messages';
const CODING_OPENAI = 'https://api.kimi.com/coding/v1/chat/completions';
const PLATFORM_CLAUDE = 'https://api.moonshot.ai/anthropic/v1/messages';
const PLATFORM_OPENAI = 'https://api.moonshot.ai/v1/chat/completions';

const APIKEY = { authType: 'apikey', apiKey: 'sk-platform' };
const OAUTH = { authType: 'oauth', accessToken: 'kimi-code-token' };

// #2881 moved API-key traffic off the Kimi Code subscription host for the two
// client formats kimi.js declares transports for. A client speaking any OTHER
// format — the Responses API is the one users actually hit — matched no transport
// at all, fell through to the provider default (the coding endpoint), and got back
// the 401 "Failed to authenticate user, please check your API key" this issue
// reports, with a key that is perfectly valid on the platform (#943).
describe('a format kimi declares no transport for still respects the credential (#943)', () => {
  it('a Responses-API client with a platform key reaches the platform, not the subscription host', () => {
    expect(resolveTransport('kimi', 'openai-responses', APIKEY)?.baseUrl).toBe(PLATFORM_CLAUDE);
  });

  it("it carries the platform's own auth shape, not the subscription host's", () => {
    const t = resolveTransport('kimi', 'openai-responses', APIKEY);
    expect(t.auth).toMatchObject({ header: 'x-api-key', scheme: 'raw' });
    // X-Msh-* device identity belongs to the Kimi Code CLI, never to the platform.
    expect(t.auth.hooks).toBeUndefined();
  });

  it('every unmatched format an API key can arrive on lands on the platform', () => {
    for (const format of ['openai-responses', 'gemini', 'antigravity']) {
      const host = new URL(resolveTransport('kimi', format, APIKEY).baseUrl).hostname;
      expect(host).toBe('api.moonshot.ai');
    }
  });

  it('the target format is unchanged, so only the host and auth scheme move', () => {
    // Before the fix this path resolved to no transport and getTargetFormat()
    // returned the provider's own format; the fallback must land on the same one
    // or the request would be serialized for an endpoint that cannot parse it.
    const route = resolveUpstreamRoute({
      provider: 'kimi',
      alias: 'kimi',
      model: 'kimi-k2.6',
      sourceFormat: 'openai-responses',
      credentials: APIKEY,
    });
    expect(route.targetFormat).toBe(PROVIDERS.kimi.format);
    expect(route.transport.baseUrl).toBe(PLATFORM_CLAUDE);
  });
});

describe('the subscription route and every other provider are untouched (#943)', () => {
  it('an OAuth subscription token on an unmatched format keeps the coding endpoint', () => {
    // No coding transport declares authModes, so OAuth claims none of them and the
    // fallback declines — leaving the provider default, which is that endpoint.
    expect(resolveTransport('kimi', 'openai-responses', OAUTH)).toBeNull();
    expect(PROVIDERS.kimi.baseUrl).toBe(CODING_CLAUDE);
  });

  it('the formats kimi does declare still resolve exactly as #2881 left them', () => {
    expect(resolveTransport('kimi', 'openai', APIKEY)?.baseUrl).toBe(PLATFORM_OPENAI);
    expect(resolveTransport('kimi', 'claude', APIKEY)?.baseUrl).toBe(PLATFORM_CLAUDE);
    expect(resolveTransport('kimi', 'openai', OAUTH)?.baseUrl).toBe(CODING_OPENAI);
    expect(resolveTransport('kimi', 'claude', OAUTH)?.baseUrl).toBe(CODING_CLAUDE);
  });

  it('a caller passing no credentials keeps resolving to null on an unmatched format', () => {
    // Standalone open-sse callers have no authType and no key: nothing claims them.
    expect(resolveTransport('kimi', 'openai-responses')).toBeNull();
  });

  it('no other provider in the registry changes, because none opts in', () => {
    // The fallback fires only where a transport names authModes. Assert that is
    // still true of the whole registry rather than of the one provider named here.
    for (const [id, config] of Object.entries(PROVIDERS)) {
      if (id === 'kimi' || !Array.isArray(config.transports)) continue;
      expect(config.transports.some((t) => Array.isArray(t.authModes))).toBe(false);
      expect(resolveTransport(id, 'no-such-format', APIKEY)).toBeNull();
    }
  });

  it('a custom compatible node is unaffected — its transports declare no authModes', () => {
    const credentials = {
      authType: 'apikey',
      apiKey: 'sk-node',
      providerSpecificData: {
        transports: [{ format: 'openai', baseUrl: 'https://node.example/v1/chat/completions' }],
      },
    };
    expect(
      resolveTransport('openai-compatible-chat-x', 'openai-responses', credentials)
    ).toBeNull();
  });
});
