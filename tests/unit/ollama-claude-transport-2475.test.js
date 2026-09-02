// #2475 — Ollama Cloud serves an Anthropic-compatible endpoint alongside its
// native one, but the provider declared a single `ollama`-format transport, so
// a Claude client was translated down to /api/chat and lost what the native
// route carries. The local sibling has the mirror-image gap: its executor
// overrides buildUrl and drops the runtimeTransport DefaultExecutor honours, so
// even a connection that resolves a transport was sent to /api/chat anyway.
import { describe, expect, it } from "vitest";

import { PROVIDERS } from "../../open-sse/config/providers.js";
import { getTargetFormat, resolveTransport } from "../../open-sse/services/provider.js";
import { OllamaLocalExecutor } from "../../open-sse/executors/ollama-local.js";

const apiKey = { apiKey: "ollama-key", authType: "apikey" };

describe("Ollama Cloud offers its Anthropic-compatible endpoint (#2475)", () => {
  it("resolves a claude transport for a Claude client", () => {
    const transport = resolveTransport("ollama", "claude", apiKey);

    expect(transport).not.toBeNull();
    expect(transport.format).toBe("claude");
    expect(transport.baseUrl).toBe("https://ollama.com/v1/messages");
  });

  it("keeps the native route as the default", () => {
    expect(getTargetFormat("ollama")).toBe("ollama");
    expect(PROVIDERS.ollama.baseUrl).toBe("https://ollama.com/api/chat");
    expect(resolveTransport("ollama", "ollama", apiKey).baseUrl).toBe(
      "https://ollama.com/api/chat"
    );
  });

  it("does not move an OpenAI-format client off the provider default", () => {
    expect(resolveTransport("ollama", "openai", apiKey)).toBeNull();
  });
});

describe("Ollama Local honours a resolved transport (#2475)", () => {
  it("uses the runtimeTransport endpoint when one is resolved", () => {
    const url = new OllamaLocalExecutor().buildUrl("qwen3.5", true, 0, {
      providerSpecificData: { baseUrl: "http://192.168.1.10:11434" },
      runtimeTransport: { format: "claude", baseUrl: "http://192.168.1.10:11434/v1/messages" },
    });

    expect(url).toBe("http://192.168.1.10:11434/v1/messages");
  });

  it("falls back to the connection host's native endpoint without one", () => {
    const url = new OllamaLocalExecutor().buildUrl("qwen3.5", true, 0, {
      providerSpecificData: { baseUrl: "http://192.168.1.10:11434" },
    });

    expect(url).toBe("http://192.168.1.10:11434/api/chat");
  });
});
