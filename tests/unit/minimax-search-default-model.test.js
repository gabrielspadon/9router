import { afterEach, describe, expect, it, vi } from "vitest";

import { handleSearchCore } from "../../open-sse/handlers/search/index.js";
import minimax from "../../open-sse/providers/registry/minimax.js";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe("MiniMax chat-backed search", () => {
  it("sends the M3 default model through the /v1/search chat request", async () => {
    let upstreamRequest;
    global.fetch = vi.fn(async (url, init) => {
      upstreamRequest = { url, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        choices: [{ message: { content: "MiniMax search answer" } }],
        usage: { total_tokens: 12 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const result = await handleSearchCore({
      body: { query: "What is the latest ocean forecast?" },
      provider: minimax,
      credentials: { apiKey: "test-key" },
    });

    expect(result.success).toBe(true);
    await expect(result.response.json()).resolves.toMatchObject({
      answer: { source: "minimax", text: "MiniMax search answer", model: "MiniMax-M3" },
    });
    expect(upstreamRequest).toMatchObject({
      url: "https://api.minimaxi.com/v1/text/chatcompletion_v2",
      body: {
        model: "MiniMax-M3",
        messages: [{ role: "user", content: "What is the latest ocean forecast?" }],
        tools: [{ type: "web_search" }],
      },
    });
  });
});
