import { beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { injectReasoningContent } from "../../open-sse/utils/reasoningContentInjector.js";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

// MiniMax M3 declares targetFormat "claude", so the router resolves the
// documented Anthropic transport for it. The registry also declares
// transport.reasoningInject, which the injector applied unconditionally, so an
// OpenAI-only `reasoning_content` key was written onto every assistant message
// of an Anthropic-shaped body and the upstream rejected the extra field (#2705).
const claudeTransport = {
  format: "claude",
  baseUrl: "https://api.minimax.io/anthropic/v1/messages",
  urlSuffix: "?beta=true",
  auth: { combined: true, header: "x-api-key", scheme: "raw" },
};
const openaiTransport = {
  format: "openai",
  baseUrl: "https://api.minimax.io/v1/chat/completions",
  auth: { combined: true, header: "Authorization", scheme: "bearer" },
};

const body = () => ({
  model: "MiniMax-M3",
  messages: [
    { role: "user", content: "weather?" },
    { role: "assistant", content: [{ type: "text", text: "checking" }] },
    { role: "user", content: "and tomorrow?" },
  ],
});

const sentBody = () => JSON.parse(fetchMock.mock.calls.at(-1)[1].body);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  }));
});

describe("MiniMax reasoning_content stays off the Anthropic wire (#2705)", () => {
  it("does not inject reasoning_content when the resolved transport is claude", async () => {
    await new DefaultExecutor("minimax").execute({
      model: "MiniMax-M3",
      body: body(),
      credentials: { apiKey: "mm-test", runtimeTransport: claudeTransport },
    });
    expect(sentBody().messages.some(m => "reasoning_content" in m)).toBe(false);
  });

  it("still injects reasoning_content on the OpenAI transport", async () => {
    await new DefaultExecutor("minimax").execute({
      model: "MiniMax-M2.7",
      body: body(),
      credentials: { apiKey: "mm-test", runtimeTransport: openaiTransport },
    });
    const assistant = sentBody().messages.find(m => m.role === "assistant");
    expect(assistant.reasoning_content).toBe(" ");
  });

  it("keeps injecting when no transport was resolved", () => {
    const out = injectReasoningContent({
      provider: "minimax",
      model: "MiniMax-M2.7",
      body: body(),
    });
    expect(out.messages.find(m => m.role === "assistant").reasoning_content).toBe(" ");
  });

  it("skips the model-level deepseek rule on a non-OpenAI wire too", () => {
    const out = injectReasoningContent({
      provider: "anthropic-compatible-x",
      model: "deepseek-v4",
      body: body(),
      targetFormat: "claude",
    });
    expect(out.messages.some(m => "reasoning_content" in m)).toBe(false);
  });
});
