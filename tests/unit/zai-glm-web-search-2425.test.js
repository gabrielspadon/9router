import { describe, it, expect } from "vitest";
import { CHAT_SEARCH_CONFIG } from "open-sse/handlers/search/chatSearch.js";
import { PROVIDER_MEDIA } from "open-sse/providers/index.js";
import { getProvidersByKind } from "@/shared/constants/providers.js";

describe("z.ai / GLM web search (#2425)", () => {
  it("is registered as a chat-based search provider", () => {
    expect(CHAT_SEARCH_CONFIG.glm).toBeTruthy();
    expect(PROVIDER_MEDIA.glm?.searchViaChat?.defaultModel).toBe("glm-4.7");
  });

  it("searches on the open-platform endpoint, not the coding one", () => {
    const url = CHAT_SEARCH_CONFIG.glm.endpoint("glm-4.7");
    expect(url).toBe("https://api.z.ai/api/paas/v4/chat/completions");
    expect(url).not.toContain("/coding/");
  });

  it("asks for the web_search tool with results attached", () => {
    const body = CHAT_SEARCH_CONFIG.glm.buildBody("who won", "glm-4.7");
    expect(body.model).toBe("glm-4.7");
    expect(body.messages).toEqual([{ role: "user", content: "who won" }]);
    const tool = body.tools[0];
    expect(tool.type).toBe("web_search");
    expect(tool.web_search.enable).toBe(true);
    expect(tool.web_search.search_result).toBe(true);
  });

  it("sends the key as a bearer token", () => {
    expect(CHAT_SEARCH_CONFIG.glm.buildHeaders("k-1").Authorization).toBe("Bearer k-1");
  });

  it("reads sources from web_search[].link, which is not named url", () => {
    const { text, citations, tokens } = CHAT_SEARCH_CONFIG.glm.extractAnswer({
      choices: [{ message: { content: "the answer" } }],
      web_search: [
        { title: "T", link: "https://a.example/1", content: "snip", refer: "ref_1" },
        { title: "no link", content: "dropped" }
      ],
      usage: { total_tokens: 42 }
    });
    expect(text).toBe("the answer");
    expect(citations).toEqual([
      { url: "https://a.example/1", title: "T", snippet: "snip" }
    ]);
    expect(tokens).toBe(42);
  });

  it("survives a reply with no sources", () => {
    const r = CHAT_SEARCH_CONFIG.glm.extractAnswer({ choices: [{ message: {} }] });
    expect(r.citations).toEqual([]);
    expect(r.text).toBe("");
  });

  it("appears in the web search provider list without losing its llm kind", () => {
    const ids = (k) => getProvidersByKind(k).map((p) => p.id);
    expect(ids("webSearch")).toContain("glm");
    expect(ids("llm")).toContain("glm");
  });
});
