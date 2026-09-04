/**
 * Unit tests for the non-streaming Claude usage conversion in
 * open-sse/handlers/chatCore/nonStreamingHandler.js (translateNonStreamingResponse).
 *
 * prompt_tokens is INCLUSIVE of cached tokens (OpenAI convention), so
 * input_tokens must subtract the cache read/creation back out instead of
 * counting the full prompt_tokens on top of the cache fields.
 */

import { describe, it, expect } from "vitest";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";

function openAIResponse(usage) {
  return {
    id: "chatcmpl-abc",
    model: "claude-sonnet-4-5",
    choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }],
    usage,
  };
}

function toClaude(usage) {
  // targetFormat = upstream response shape (OpenAI), sourceFormat = client (Claude)
  return translateNonStreamingResponse(openAIResponse(usage), "openai", "claude").usage;
}

describe("non-streaming usage cache split", () => {
  it("subtracts cached tokens from inclusive prompt_tokens (1000/900 -> 100/900)", () => {
    const usage = toClaude({
      prompt_tokens: 1000,
      completion_tokens: 50,
      total_tokens: 1050,
      prompt_tokens_details: { cached_tokens: 900 },
    });
    expect(usage.input_tokens).toBe(100);
    expect(usage.output_tokens).toBe(50);
    expect(usage.cache_read_input_tokens).toBe(900);
  });

  it("subtracts cache creation tokens too", () => {
    const usage = toClaude({
      prompt_tokens: 1000,
      completion_tokens: 50,
      prompt_tokens_details: { cached_tokens: 700, cache_creation_tokens: 200 },
    });
    expect(usage.input_tokens).toBe(100);
    expect(usage.cache_read_input_tokens).toBe(700);
    expect(usage.cache_creation_input_tokens).toBe(200);
  });

  it("keeps an exclusive input_tokens source as-is", () => {
    const usage = toClaude({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 900,
    });
    expect(usage.input_tokens).toBe(100);
    expect(usage.cache_read_input_tokens).toBe(900);
  });

  it("emits no cache fields when the upstream reported no cache activity", () => {
    const usage = toClaude({ prompt_tokens: 500, completion_tokens: 20 });
    expect(usage.input_tokens).toBe(500);
    expect(usage.output_tokens).toBe(20);
    expect(usage).not.toHaveProperty("cache_read_input_tokens");
    expect(usage).not.toHaveProperty("cache_creation_input_tokens");
  });

  it("clamps input_tokens at zero when cached exceeds prompt_tokens", () => {
    const usage = toClaude({
      prompt_tokens: 100,
      completion_tokens: 10,
      prompt_tokens_details: { cached_tokens: 900 },
    });
    expect(usage.input_tokens).toBe(0);
    expect(usage.cache_read_input_tokens).toBe(900);
  });
});
