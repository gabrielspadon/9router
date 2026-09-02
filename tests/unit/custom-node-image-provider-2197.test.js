import { describe, expect, it } from "vitest";
import { getImageAdapter, isImageProvider } from "open-sse/handlers/imageProviders/index.js";

// A user-declared OpenAI-compatible node already serves chat and, through
// custom-embedding, embeddings — both taking their endpoint from the connection.
// Image generation had no equivalent, so "custom media providers" (#2197) was
// only true for text. The node id reaches handleImageGenerationCore already;
// what was missing is an adapter for it.
const NODE = "openai-compatible-chat-abc123";
const MULTI = "openai-compatible-multi-def456";
const creds = (baseUrl) => ({ apiKey: "k", providerSpecificData: { baseUrl } });

describe("custom OpenAI-compatible nodes generate images (#2197)", () => {
  it("resolves an adapter for a custom node id", () => {
    expect(getImageAdapter(NODE)).toBeTruthy();
    expect(getImageAdapter(MULTI)).toBeTruthy();
    expect(isImageProvider(NODE)).toBe(true);
  });

  it("takes the endpoint from the connection, not a registry entry", () => {
    const adapter = getImageAdapter(NODE);
    expect(adapter.buildUrl("sd-xl", creds("https://images.example.com/v1"), {}))
      .toBe("https://images.example.com/v1/images/generations");
  });

  it("tolerates a trailing slash or a pasted full endpoint", () => {
    const adapter = getImageAdapter(NODE);
    expect(adapter.buildUrl("m", creds("https://x.test/v1/"), {}))
      .toBe("https://x.test/v1/images/generations");
    expect(adapter.buildUrl("m", creds("https://x.test/v1/images/generations"), {}))
      .toBe("https://x.test/v1/images/generations");
  });

  it("still sends an OpenAI-shaped body and bearer auth", () => {
    const adapter = getImageAdapter(NODE);
    expect(adapter.buildHeaders(creds("https://x.test/v1")).Authorization).toBe("Bearer k");
    expect(adapter.buildBody("sd-xl", { prompt: "a cat" }))
      .toMatchObject({ model: "sd-xl", prompt: "a cat", n: 1 });
  });

  it("leaves a built-in provider on its own adapter", () => {
    expect(getImageAdapter("gemini")).toBe(getImageAdapter("gemini"));
    expect(getImageAdapter("not-a-provider")).toBe(null);
  });
});
