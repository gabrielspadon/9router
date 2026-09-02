// Upstream 2f17352cc — Antigravity as a web search provider.
//
// /v1/search with provider "antigravity" runs Google Search grounding on the
// Antigravity OAuth pool. The chat-search path derives BOTH the model and the
// endpoint from the registry entry's `searchViaChat` block (chatSearch.js
// searchModel/searchEndpoint), so the registry is the single source and a
// missing block silently makes the provider unroutable.
import { afterEach, describe, expect, it, vi } from 'vitest';
import antigravity from 'open-sse/providers/registry/antigravity.js';
import { ANTIGRAVITY_IDE_BASE_URL } from 'open-sse/providers/shared.js';
import { CHAT_SEARCH_CONFIG, handleChatSearch } from 'open-sse/handlers/search/chatSearch.js';
import { AI_PROVIDERS } from '@/shared/constants/providers.js';

const GROUNDED = {
  response: {
    candidates: [
      {
        content: {
          parts: [{ text: 'Ottawa is the capital of Canada. It sits on the Ottawa River.' }],
        },
        groundingMetadata: {
          // Upstream repeats one source across chunks — must collapse to ONE citation.
          groundingChunks: [
            { web: { uri: 'https://example.org/a', title: 'A' } },
            { web: { uri: 'https://example.org/a', title: 'A' } },
            { web: { uri: 'https://example.org/b', title: 'B' } },
          ],
          groundingSupports: [
            {
              segment: { startIndex: 0, endIndex: 35, text: 'Ottawa is the capital of Canada.' },
              groundingChunkIndices: [0],
            },
            {
              segment: { startIndex: 36, endIndex: 62, text: 'It sits on the Ottawa River.' },
              groundingChunkIndices: [1, 2],
            },
          ],
        },
      },
    ],
    usageMetadata: { totalTokenCount: 42 },
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('antigravity registry declares webSearch via chat', () => {
  it('lists webSearch among its service kinds', () => {
    expect(antigravity.serviceKinds).toContain('webSearch');
  });

  it('carries the grounding model and endpoint on searchViaChat', () => {
    expect(antigravity.searchViaChat?.defaultModel).toBe('gemini-2.5-flash');
    expect(antigravity.searchViaChat?.endpoint).toBe(
      `${ANTIGRAVITY_IDE_BASE_URL}/v1internal:generateContent`
    );
  });

  it('survives the registry → AI_PROVIDERS projection', () => {
    // src/sse/handlers/search.js gates on AI_PROVIDERS[...].searchViaChat, not
    // on the raw registry entry.
    expect(AI_PROVIDERS.antigravity?.searchViaChat?.defaultModel).toBe('gemini-2.5-flash');
  });
});

describe('chat-search config for antigravity', () => {
  it('is registered', () => {
    expect(CHAT_SEARCH_CONFIG.antigravity).toBeTruthy();
  });

  it('resolves its endpoint from the registry rather than a literal', () => {
    expect(CHAT_SEARCH_CONFIG.antigravity.endpoint()).toBe(antigravity.searchViaChat.endpoint);
  });

  it('reports a missing projectId instead of letting upstream 403 misleadingly', () => {
    const cfg = CHAT_SEARCH_CONFIG.antigravity;
    expect(cfg.requireCredentials({ accessToken: 't' })).toMatch(/projectId/i);
    expect(cfg.requireCredentials({ accessToken: 't', projectId: 'p-1' })).toBeNull();
  });

  it('merges repeated chunk URLs into one citation carrying snippet and content', () => {
    const { text, citations, tokens } = CHAT_SEARCH_CONFIG.antigravity.extractAnswer(GROUNDED);
    expect(text).toContain('Ottawa');
    expect(tokens).toBe(42);
    expect(citations.map((c) => c.url)).toEqual(['https://example.org/a', 'https://example.org/b']);
    const a = citations[0];
    expect(a.snippet).toContain('Ottawa is the capital of Canada.');
    expect(a.snippet).toContain('It sits on the Ottawa River.');
    expect(a.content).toBeTruthy();
  });
});

describe('a search routed to antigravity', () => {
  it('posts the grounding model and endpoint the registry declares', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(GROUNDED), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await handleChatSearch({
      provider: 'antigravity',
      query: 'capital of canada',
      credentials: { accessToken: 'tok-1', projectId: 'proj-1' },
    });

    expect(result.success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(antigravity.searchViaChat.endpoint);
    const body = JSON.parse(init.body);
    expect(body.model).toBe(antigravity.searchViaChat.defaultModel);
    expect(body.project).toBe('proj-1');
    expect(body.request.tools).toEqual([{ googleSearch: {} }]);
    expect(init.headers.Authorization).toBe('Bearer tok-1');

    // Grounded context reaches the client — the unified result shape must not
    // null out `content` the way it does for citation-only providers.
    expect(result.data.results[0].content).toBeTruthy();
  });

  it('refuses a connection with no projectId before spending an upstream call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await handleChatSearch({
      provider: 'antigravity',
      query: 'capital of canada',
      credentials: { accessToken: 'tok-1' },
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
