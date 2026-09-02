import { describe, expect, it } from "vitest";
import { resolveOpenAICompatibleApiType } from "open-sse/services/provider.js";

// An openai-compatible node's id embeds the API type it was CREATED with
// (openai-compatible-chat-<uuid>), and the id never changes. Resolving the type
// from the id meant editing a node to Responses had no runtime effect: the
// request still went through Chat Completions and a /v1/responses caller got a
// chat.completion object with no output array (#2778). The stored apiType on the
// connection is authoritative; the id is only a fallback for nodes created
// before it was persisted.
const withStored = (apiType) => ({ providerSpecificData: { apiType } });

describe("an edited node's API type wins over its immutable id (#2778)", () => {
  it("a chat-born node switched to responses resolves as responses", () => {
    expect(resolveOpenAICompatibleApiType("openai-compatible-chat-abc", withStored("responses")))
      .toBe("responses");
  });

  it("and the reverse, so switching back also takes effect", () => {
    expect(resolveOpenAICompatibleApiType("openai-compatible-responses-abc", withStored("chat")))
      .toBe("chat");
  });

  it("falls back to the id for a legacy node that never stored one", () => {
    expect(resolveOpenAICompatibleApiType("openai-compatible-responses-abc", null)).toBe("responses");
    expect(resolveOpenAICompatibleApiType("openai-compatible-chat-abc", null)).toBe("chat");
    expect(resolveOpenAICompatibleApiType("openai-compatible-chat-abc", {})).toBe("chat");
  });

  it("ignores a stored value that is not one of the two types", () => {
    // Anything else is untrustworthy input, not a third mode.
    for (const bad of ["", "Responses", "completions", 1, true, null])
      expect(resolveOpenAICompatibleApiType("openai-compatible-responses-abc", withStored(bad)))
        .toBe("responses");
  });

  it("defaults to chat when neither the store nor the id says anything", () => {
    expect(resolveOpenAICompatibleApiType("some-node-id", null)).toBe("chat");
    expect(resolveOpenAICompatibleApiType(null, null)).toBe("chat");
  });
});
