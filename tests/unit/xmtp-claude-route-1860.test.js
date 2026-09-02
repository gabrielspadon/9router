import { describe, expect, it } from "vitest";
import { resolveUpstreamRoute } from "open-sse/handlers/chatCore/upstreamRoute.js";
import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";
import { PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";

// An OpenAI client using xmtp/mimo-v2.5-pro-claude had its tools rejected with
// "'function' is not set": the body was translated to Claude shape but the
// transport was still picked from the CLIENT format, so a Claude body went to
// /chat/completions with bearer auth (#1860). The registry row declares
// targetFormat "claude"; the route has to follow it.
describe("a model-level targetFormat moves the transport with it (#1860)", () => {
  // The alias chatCore passes is PROVIDER_ID_TO_ALIAS[provider], which for this
  // provider is the id itself: its registry `alias` equals its id and "xmtp" is
  // only the uiAlias. PROVIDER_MODELS is keyed the same way, so passing "xmtp"
  // here would silently miss every row and test nothing.
  const route = (model, sourceFormat) =>
    resolveUpstreamRoute({
      provider: "xiaomi-tokenplan", alias: "xiaomi-tokenplan", model, sourceFormat, credentials: null,
    });

  it("the alias used for model lookup is the one chatCore derives", () => {
    expect(PROVIDER_ID_TO_ALIAS["xiaomi-tokenplan"]).toBe("xiaomi-tokenplan");
    expect(PROVIDER_MODELS["xiaomi-tokenplan"]?.some((m) => m.id === "mimo-v2.5-pro-claude")).toBe(true);
  });

  it("an OpenAI client on the -claude model routes to the claude transport", () => {
    const { targetFormat, transport } = route("mimo-v2.5-pro-claude", "openai");
    expect(targetFormat).toBe("claude");
    expect(transport?.format).toBe("claude");
  });

  it("that transport carries Anthropic auth, not bearer", () => {
    // The concrete failure: a Claude body over the OpenAI transport got bearer
    // auth and /chat/completions, and the tool schema 400'd.
    const { transport } = route("mimo-v2.5-pro-claude", "openai");
    expect(transport.auth.header).toBe("x-api-key");
    expect(transport.auth.scheme).toBe("raw");
  });

  it("the plain model still follows the client's own format", () => {
    const { targetFormat, transport } = route("mimo-v2.5-pro", "openai");
    expect(targetFormat).toBe("openai");
    expect(transport?.format).toBe("openai");
  });

  it("a Claude client on the plain model gets the claude transport", () => {
    const { transport } = route("mimo-v2.5-pro", "claude");
    expect(transport?.format).toBe("claude");
  });
});
