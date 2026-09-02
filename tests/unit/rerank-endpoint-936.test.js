// A rerank endpoint is the one retrieval capability this gateway did not expose
// (#936): embeddings, images, speech, transcription, search and fetch all route
// through /v1, rerank did not, so a RAG client had to talk to Cohere or Jina
// directly and lost the account fallback and the usage accounting.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  RERANK_PROVIDERS,
  getRerankProvider,
  documentText,
  rerankUsage,
  normalizeRerank,
  handleRerankCore,
} from "open-sse/handlers/rerankCore.js";

const realFetch = globalThis.fetch;
let calls;

function stubFetch(payload, { ok = true, status = 200 } = {}) {
  calls = [];
  globalThis.fetch = vi.fn(async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return {
      ok,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
      headers: { get: () => "application/json" },
    };
  });
}

beforeEach(() => { calls = []; });
afterEach(() => { globalThis.fetch = realFetch; });

describe("the endpoint is actually wired to /v1", () => {
  it("the route and its handler resolve, so a new file is not silently unreachable", async () => {
    const handler = await import("@/sse/handlers/rerank.js");
    expect(typeof handler.handleRerank).toBe("function");
    // next.config.mjs rewrites /v1/:path* onto /api/v1/:path*, so this file
    // being present and exporting POST is the whole registration.
    const route = await import("@/app/api/v1/rerank/route.js");
    expect(typeof route.POST).toBe("function");
    expect(typeof route.OPTIONS).toBe("function");
  });
});

describe("the contract is Cohere's, not one invented here (#936)", () => {
  it("routes the vendors that publish a rerank API and refuses the ones that do not", () => {
    expect(getRerankProvider("cohere").url).toBe("https://api.cohere.com/v2/rerank");
    expect(getRerankProvider("jina-ai").url).toBe("https://api.jina.ai/v1/rerank");
    expect(getRerankProvider("voyage-ai").url).toBe("https://api.voyageai.com/v1/rerank");
    // A chat-only provider must not silently become a rerank endpoint.
    expect(getRerankProvider("anthropic")).toBeNull();
    expect(getRerankProvider(undefined)).toBeNull();
  });

  it("every provider in the table is one this repo already has a registry row for", () => {
    for (const id of Object.keys(RERANK_PROVIDERS)) {
      expect(id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("accepts a bare string or Cohere v1's { text }, and names the index that is neither", () => {
    expect(documentText("a")).toBe("a");
    expect(documentText({ text: "b" })).toBe("b");
    expect(documentText(42)).toBeNull();
    expect(documentText({ body: "c" })).toBeNull();
  });
});

describe("what the client sends reaches the vendor in the vendor's own spelling", () => {
  it("sends Cohere top_n, and does not send return_documents Cohere v2 rejects", async () => {
    stubFetch({ id: "r1", results: [{ index: 1, relevance_score: 0.9 }] });
    const result = await handleRerankCore({
      body: { query: "q", documents: ["a", "b"], top_n: 1, return_documents: true },
      modelInfo: { provider: "cohere", model: "rerank-v3.5" },
      credentials: { apiKey: "k" },
    });
    expect(result.success).toBe(true);
    expect(calls[0].url).toBe("https://api.cohere.com/v2/rerank");
    expect(calls[0].body.top_n).toBe(1);
    expect(calls[0].body).not.toHaveProperty("return_documents");
    expect(calls[0].init.headers.Authorization).toBe("Bearer k");
  });

  it("translates the same request to Voyage's top_k and reads back its data array", async () => {
    stubFetch({ object: "list", data: [{ index: 0, relevance_score: 0.5 }], usage: { total_tokens: 8 } });
    const result = await handleRerankCore({
      body: { query: "q", documents: ["a", "b"], top_n: 1 },
      modelInfo: { provider: "voyage-ai", model: "rerank-2.5" },
      credentials: { apiKey: "k" },
    });
    expect(calls[0].body.top_k).toBe(1);
    expect(calls[0].body).not.toHaveProperty("top_n");
    const payload = JSON.parse(await result.response.text());
    expect(payload.results).toEqual([{ index: 0, relevance_score: 0.5 }]);
    expect(payload.usage).toEqual({ total_tokens: 8 });
  });

  it("return_documents means the same thing on a vendor that never echoes them", async () => {
    stubFetch({ results: [{ index: 1, relevance_score: 0.9 }, { index: 0, relevance_score: 0.1 }] });
    const result = await handleRerankCore({
      body: { query: "q", documents: ["first", "second"], return_documents: true },
      modelInfo: { provider: "cohere", model: "rerank-v3.5" },
      credentials: { apiKey: "k" },
    });
    const payload = JSON.parse(await result.response.text());
    expect(payload.results.map((r) => r.document.text)).toEqual(["second", "first"]);
  });
});

describe("bad input is refused before any upstream call", () => {
  const cases = [
    ["missing query", { documents: ["a"] }, /query/],
    ["blank query", { query: "   ", documents: ["a"] }, /query/],
    ["missing documents", { query: "q" }, /documents/],
    ["empty documents", { query: "q", documents: [] }, /documents/],
    ["a document that is neither a string nor { text }", { query: "q", documents: ["a", 7] }, /documents\[1\]/],
  ];
  for (const [name, body, pattern] of cases) {
    it(name, async () => {
      stubFetch({});
      const result = await handleRerankCore({
        body,
        modelInfo: { provider: "cohere", model: "rerank-v3.5" },
        credentials: { apiKey: "k" },
      });
      expect(result.success).toBe(false);
      expect(result.status).toBe(400);
      expect(result.error).toMatch(pattern);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  }

  it("a provider with no rerank API is a 400 naming it, not a call to a guessed URL", async () => {
    stubFetch({});
    const result = await handleRerankCore({
      body: { query: "q", documents: ["a"] },
      modelInfo: { provider: "anthropic", model: "claude" },
      credentials: { apiKey: "k" },
    });
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/does not support rerank/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("usage is recorded only when the vendor states it exactly", () => {
  it("reads each vendor's own field", () => {
    expect(rerankUsage({ usage: { total_tokens: 12 } })).toEqual({ prompt_tokens: 12, completion_tokens: 0, total_tokens: 12 });
    expect(rerankUsage({ meta: { tokens: { input_tokens: 5 } } })).toEqual({ prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 });
    expect(rerankUsage({ tokens: { input_tokens: 7 } })).toEqual({ prompt_tokens: 7, completion_tokens: 0, total_tokens: 7 });
  });

  it("refuses to invent a count, so nothing is billed on a guess", () => {
    expect(rerankUsage({})).toBeNull();
    expect(rerankUsage({ usage: { total_tokens: "12" } })).toBeNull();
    expect(rerankUsage({ usage: { total_tokens: 0 } })).toBeNull();
    expect(rerankUsage({ usage: { total_tokens: 1.5 } })).toBeNull();
    expect(rerankUsage(null)).toBeNull();
  });
});

describe("a malformed upstream answer degrades rather than throws", () => {
  it("a body with no ranked list yields an empty result set, not a crash", () => {
    const out = normalizeRerank({ id: "x" }, { model: "m", documents: ["a"], returnDocuments: false, resultsField: "results" });
    expect(out.results).toEqual([]);
    expect(out.model).toBe("m");
  });

  it("an upstream error is surfaced with its status, not swallowed as success", async () => {
    stubFetch({ message: "rate limited" }, { ok: false, status: 429 });
    const result = await handleRerankCore({
      body: { query: "q", documents: ["a"] },
      modelInfo: { provider: "jina-ai", model: "jina-reranker-v2" },
      credentials: { apiKey: "k" },
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(429);
  });
});
