import { describe, it, expect } from "vitest";
import { DefaultExecutor } from "open-sse/executors/default.js";

// A per-connection endpoint was stored for every built-in provider but never
// read, so a registry entry shipping a single URL could not be pointed
// anywhere else (#3253). The field means the same thing it means for a
// compatible node: a base, with the provider's operation path appended.
const withBase = (baseUrl) => ({ apiKey: "k", providerSpecificData: { baseUrl } });

describe("per-connection endpoint override (#3253)", () => {
  it("keeps the registry URL when no override is stored", () => {
    const ex = new DefaultExecutor("deepseek");
    expect(ex.buildUrl("m", false, 0, { apiKey: "k" })).toBe(ex.config.baseUrl);
  });

  it("appends the provider's operation path to a base", () => {
    const ex = new DefaultExecutor("deepseek");
    const url = ex.buildUrl("m", false, 0, withBase("https://proxy.internal/v1"));
    expect(url).toBe("https://proxy.internal/v1/chat/completions");
  });

  it("does not double the operation path when the full endpoint is given", () => {
    const ex = new DefaultExecutor("deepseek");
    const full = "https://proxy.internal/v1/chat/completions";
    expect(ex.buildUrl("m", false, 0, withBase(full))).toBe(full);
  });

  it("ignores a trailing slash on the stored value", () => {
    const ex = new DefaultExecutor("deepseek");
    const url = ex.buildUrl("m", false, 0, withBase("https://proxy.internal/v1/"));
    expect(url).toBe("https://proxy.internal/v1/chat/completions");
  });

  it("redirects the Anthropic wire to its own operation path", () => {
    const ex = new DefaultExecutor("anthropic");
    const url = ex.buildUrl("m", false, 0, withBase("https://proxy.internal"));
    expect(url).toBe("https://proxy.internal/v1/messages");
  });
});
