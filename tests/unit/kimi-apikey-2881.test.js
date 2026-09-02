import { describe, expect, it } from "vitest";
import { PROVIDERS } from "open-sse/config/providers.js";
import { credentialAuthMode, resolveTransport } from "open-sse/services/provider.js";
import { resolveUpstreamRoute } from "open-sse/handlers/chatCore/upstreamRoute.js";

const CODING_OPENAI = "https://api.kimi.com/coding/v1/chat/completions";
const CODING_CLAUDE = "https://api.kimi.com/coding/v1/messages";
const PLATFORM_OPENAI = "https://api.moonshot.ai/v1/chat/completions";
const PLATFORM_CLAUDE = "https://api.moonshot.ai/anthropic/v1/messages";

const APIKEY = { authType: "apikey", apiKey: "sk-platform" };
const OAUTH = { authType: "oauth", accessToken: "kimi-code-token" };

// api.kimi.com/coding is the Kimi Code subscription product and rejects a
// platform API key with 401, however valid the key is. Transport selection
// matched on the client's format alone, so both credential kinds landed on the
// same endpoint and no registry entry could separate them (#2881).
describe("kimi routes an API key to the platform, not the coding endpoint (#2881)", () => {
  it("an api-key connection reaches the platform chat endpoint", () => {
    expect(resolveTransport("kimi", "openai", APIKEY)?.baseUrl).toBe(PLATFORM_OPENAI);
  });

  it("an api-key connection reaches the platform anthropic endpoint", () => {
    expect(resolveTransport("kimi", "claude", APIKEY)?.baseUrl).toBe(PLATFORM_CLAUDE);
  });

  it("the platform transports carry the auth shape their endpoint needs", () => {
    expect(resolveTransport("kimi", "openai", APIKEY).auth).toMatchObject({ header: "Authorization", scheme: "bearer" });
    const claude = resolveTransport("kimi", "claude", APIKEY);
    expect(claude.auth).toMatchObject({ header: "x-api-key", scheme: "raw" });
    expect(claude.headers["Anthropic-Version"]).toBeTruthy();
  });

  it("the platform transports drop the Kimi Code CLI device headers", () => {
    // X-Msh-* is the coding CLI's identity; the platform API is not that client.
    expect(resolveTransport("kimi", "openai", APIKEY).auth.hooks).toBeUndefined();
    expect(resolveTransport("kimi", "claude", APIKEY).auth.hooks).toBeUndefined();
  });

  it("the working OAuth subscription route is untouched", () => {
    expect(resolveTransport("kimi", "openai", OAUTH)?.baseUrl).toBe(CODING_OPENAI);
    expect(resolveTransport("kimi", "claude", OAUTH)?.baseUrl).toBe(CODING_CLAUDE);
    expect(resolveTransport("kimi", "claude", OAUTH).auth.hooks).toEqual(["kimiHeaders"]);
  });

  it("a caller passing no credentials keeps the pre-change endpoint", () => {
    // Standalone open-sse callers and the provider default must not move.
    expect(resolveTransport("kimi", "openai")?.baseUrl).toBe(CODING_OPENAI);
    expect(resolveTransport("kimi", "claude", null)?.baseUrl).toBe(CODING_CLAUDE);
    expect(PROVIDERS.kimi.baseUrl).toBe(CODING_CLAUDE);
  });

  it("the whole upstream route follows, not just the transport lookup", () => {
    const route = resolveUpstreamRoute({
      provider: "kimi", alias: "kimi", model: "kimi-k3", sourceFormat: "openai", credentials: APIKEY,
    });
    expect(route.transport.baseUrl).toBe(PLATFORM_OPENAI);
    expect(route.targetFormat).toBe("openai");
    const oauthRoute = resolveUpstreamRoute({
      provider: "kimi", alias: "kimi", model: "kimi-k3", sourceFormat: "openai", credentials: OAUTH,
    });
    expect(oauthRoute.transport.baseUrl).toBe(CODING_OPENAI);
  });
});

describe("credential-scoped selection is opt-in (#2881)", () => {
  it("a provider declaring no authModes resolves identically for both credential kinds", () => {
    for (const format of ["openai", "claude"]) {
      const viaKey = resolveTransport("glm-cn", format, APIKEY);
      const viaOauth = resolveTransport("glm-cn", format, OAUTH);
      const viaNothing = resolveTransport("glm-cn", format);
      expect(viaKey).toBe(viaNothing);
      expect(viaOauth).toBe(viaNothing);
    }
  });

  it("every provider without an authModes transport still returns its first format match", () => {
    // Guards the whole registry, not just the one provider the issue names.
    for (const [id, config] of Object.entries(PROVIDERS)) {
      if (!Array.isArray(config.transports)) continue;
      if (config.transports.some((t) => Array.isArray(t.authModes))) continue;
      for (const format of new Set(config.transports.map((t) => t.format))) {
        const first = config.transports.find((t) => t.format === format);
        expect(resolveTransport(id, format, APIKEY)).toBe(first);
        expect(resolveTransport(id, format, OAUTH)).toBe(first);
      }
    }
  });

  it("a custom node's compiled transports are unaffected", () => {
    // Custom openai-compatible nodes carry their transports on the credential,
    // never on PROVIDERS, and none of them declares authModes.
    const credentials = {
      authType: "apikey",
      apiKey: "sk-node",
      providerSpecificData: {
        transports: [
          { format: "openai", baseUrl: "https://node.example/v1/chat/completions" },
          { format: "claude", baseUrl: "https://node.example/v1/messages" },
        ],
      },
    };
    expect(resolveTransport("openai-compatible-chat-x", "openai", credentials).baseUrl).toBe("https://node.example/v1/chat/completions");
    expect(resolveTransport("openai-compatible-chat-x", "claude", credentials).baseUrl).toBe("https://node.example/v1/messages");
    expect(resolveTransport("openai-compatible-chat-x", "gemini", credentials)).toBeNull();
  });

  it("an unmatched format resolves to null unless a transport claims the credential", () => {
    // Restated, not relaxed. Resolving to null hands the request to the provider
    // DEFAULT, and for kimi that default is the subscription host — so returning
    // null for an API key was the same 401 this file exists to prevent, on the
    // formats the fork declares no transport for (#943). Null stays correct where
    // nothing is scoped to the credential, which is every other provider.
    expect(resolveTransport("kimi", "gemini", APIKEY)?.baseUrl).toBe(PLATFORM_CLAUDE);
    expect(resolveTransport("kimi", "gemini", OAUTH)).toBeNull();
    expect(resolveTransport("anthropic", "openai", APIKEY)).toBeNull();
  });

  it("a credential kind no transport claims falls back to the unscoped entry", () => {
    expect(resolveTransport("kimi", "openai", { authType: "cookie" })?.baseUrl).toBe(CODING_OPENAI);
  });
});

describe("credentialAuthMode normalizes the stored authType (#2881)", () => {
  it("reads both spellings of an API key", () => {
    expect(credentialAuthMode({ authType: "apikey" })).toBe("apikey");
    expect(credentialAuthMode({ authType: "api_key" })).toBe("apikey");
  });

  it("treats a hand-pasted access_token as OAuth", () => {
    expect(credentialAuthMode({ authType: "access_token" })).toBe("oauth");
    expect(credentialAuthMode({ authType: "oauth" })).toBe("oauth");
  });

  it("falls back to the credential shape when authType is absent", () => {
    expect(credentialAuthMode({ apiKey: "sk-x" })).toBe("apikey");
    expect(credentialAuthMode({ accessToken: "tok" })).toBe("oauth");
    expect(credentialAuthMode(null)).toBe("oauth");
  });
});
