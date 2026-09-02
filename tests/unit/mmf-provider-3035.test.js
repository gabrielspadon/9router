import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";

// #3035: mmf/mimo-auto (MiMo Code Free) returns 403 Illegal access directly and
// 400 Unsupported model via the gateway. Xiaomi's free MiMo channel has ended
// (see registry/mimo-free.js, which documents the same shutdown for its "mmf"
// alias). The transport (baseUrl/noAuth) stays pinned by the providers
// baseline and unreachable regardless, so the catalog is what can still lie:
// it should not advertise a model id upstream now rejects with every call.
describe("mmf provider (#3035)", () => {
  it("does not advertise the dead free-tier model in its catalog", () => {
    expect(PROVIDER_MODELS.mmf).toEqual([]);
  });

  it("keeps the pinned dead transport untouched (baseline still governs it)", () => {
    expect(PROVIDERS.mmf.baseUrl).toBe("https://api.xiaomimimo.com/api/free-ai/openai/chat");
    expect(PROVIDERS.mmf.noAuth).toBe(true);
  });
});
