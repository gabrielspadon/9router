import { describe, expect, it } from "vitest";
import { PROVIDERS } from "open-sse/config/providers.js";
import { resolveTransport } from "open-sse/services/provider.js";

// Connecting Claude to the vendor's own Anthropic-compatible endpoint gives web
// search and image reading; through TokenProxy's GLM (China) provider both were
// lost. The provider only ever had the OpenAI-compatible coding endpoint, so a
// Claude client was translated down to it and the server-side capabilities that
// live on the other endpoint went with the translation (#1746).
describe("glm-cn offers the vendor's Anthropic endpoint (#1746)", () => {
  it("a claude client routes to the anthropic-compatible endpoint", () => {
    const t = resolveTransport("glm-cn", "claude");
    expect(t?.baseUrl).toBe("https://open.bigmodel.cn/api/anthropic/v1/messages");
  });

  it("an openai client still routes to the coding endpoint", () => {
    const t = resolveTransport("glm-cn", "openai");
    expect(t?.baseUrl).toBe("https://open.bigmodel.cn/api/coding/paas/v4/chat/completions");
  });

  it("the claude transport carries Anthropic auth and headers", () => {
    // Bearer against /api/anthropic would 401; the header shape has to move
    // with the endpoint.
    const t = resolveTransport("glm-cn", "claude");
    expect(t.auth).toMatchObject({ header: "x-api-key", scheme: "raw" });
    expect(t.headers["Anthropic-Version"]).toBeTruthy();
  });

  it("the default transport is unchanged, so existing users are not moved", () => {
    // Only a Claude-format client picks the new endpoint; everything else keeps
    // the behaviour it had.
    expect(PROVIDERS["glm-cn"].baseUrl).toBe("https://open.bigmodel.cn/api/coding/paas/v4/chat/completions");
    expect(PROVIDERS["glm-cn"].format).toBe("openai");
  });

  it("it mirrors the international sibling rather than inventing a shape", () => {
    const cn = PROVIDERS["glm-cn"].transports.map((t) => t.format).sort();
    const intl = PROVIDERS["glm"].transports.map((t) => t.format).sort();
    expect(cn).toEqual(intl);
  });

  it("the usage endpoint is untouched", () => {
    expect(PROVIDERS["glm-cn"].usage?.url).toBe("https://open.bigmodel.cn/api/monitor/usage/quota/limit");
  });
});
