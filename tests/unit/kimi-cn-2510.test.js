import { describe, expect, it } from "vitest";
import REGISTRY from "open-sse/providers/registry/index.js";
import { PROVIDERS } from "open-sse/config/providers.js";
import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";
import { resolveProviderAlias } from "open-sse/services/model.js";
import { resolveTransport } from "open-sse/services/provider.js";

// Every Kimi endpoint in the tree pointed at the international hosts, so a
// mainland account had nowhere to connect (#2510). Served the way the tree
// already serves the same split for GLM and MiniMax: a sibling entry, not a
// region flag on the existing one.
describe("kimi-cn reaches the China-region platform (#2510)", () => {
  it("is registered exactly once and resolves as its own provider", () => {
    expect(REGISTRY.filter((e) => e.id === "kimi-cn")).toHaveLength(1);
    expect(resolveProviderAlias("kimi-cn")).toBe("kimi-cn");
    expect(resolveProviderAlias("kimi")).toBe("kimi");
  });

  it("every endpoint it declares is on the China host", () => {
    const urls = [PROVIDERS["kimi-cn"].baseUrl, ...PROVIDERS["kimi-cn"].transports.map((t) => t.baseUrl)];
    expect(urls.every((u) => u.startsWith("https://api.moonshot.cn/"))).toBe(true);
  });

  it("picks the endpoint matching the client format", () => {
    expect(resolveTransport("kimi-cn", "openai")?.baseUrl).toBe("https://api.moonshot.cn/v1/chat/completions");
    expect(resolveTransport("kimi-cn", "claude")?.baseUrl).toBe("https://api.moonshot.cn/anthropic/v1/messages");
  });

  it("carries the auth shape each endpoint needs", () => {
    expect(resolveTransport("kimi-cn", "openai").auth).toMatchObject({ header: "Authorization", scheme: "bearer" });
    const claude = resolveTransport("kimi-cn", "claude");
    expect(claude.auth).toMatchObject({ header: "x-api-key", scheme: "raw" });
    expect(claude.headers["Anthropic-Version"]).toBeTruthy();
  });

  it("mirrors the sibling pattern rather than inventing one", () => {
    const formats = (id) => PROVIDERS[id].transports.map((t) => t.format).sort();
    expect(formats("kimi-cn")).toEqual(formats("glm-cn"));
  });

  it("lists the platform model ids and omits the coding-subscription ones", () => {
    const ids = PROVIDER_MODELS["kimi-cn"].map((m) => m.id);
    expect(ids).toContain("kimi-k3");
    expect(ids).toContain("kimi-k2.7-code");
    // `k3` and `kimi-for-coding*` are Kimi Code ids, international-only.
    expect(ids).not.toContain("k3");
    expect(ids.some((id) => id.startsWith("kimi-for-coding"))).toBe(false);
  });

  it("leaves the international entry alone", () => {
    expect(PROVIDERS.kimi.baseUrl).toBe("https://api.kimi.com/coding/v1/messages");
    expect(PROVIDER_MODELS.kimi.map((m) => m.id)).toContain("k3");
  });

  it("is API-key only, since Kimi Code OAuth is international", () => {
    const entry = REGISTRY.find((e) => e.id === "kimi-cn");
    expect(entry.category).toBe("apikey");
    expect(entry.oauth).toBeUndefined();
    expect(entry.hasOAuth).toBeFalsy();
  });
});
