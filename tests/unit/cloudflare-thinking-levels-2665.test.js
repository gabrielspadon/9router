import { describe, expect, it } from "vitest";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import { applyThinking } from "open-sse/translator/concerns/thinkingUnified.js";

// Cloudflare Workers AI is an OpenAI-compatible gateway, so the provider
// declares thinkingFormat "openai" and every model on it inherited the full
// OpenAI ladder — xhigh included. Cloudflare's validator rejects xhigh, so the
// request answered 400 and the account was marked unavailable (#2665).
describe("cloudflare-ai thinking levels stop at high (#2665)", () => {
  const MODEL = "@cf/moonshotai/kimi-k2.6";

  it("xhigh is not offered", () => {
    const levels = getThinkingLevels("cloudflare-ai", MODEL);
    expect(levels).not.toContain("xhigh");
    expect(levels).not.toContain("max");
    expect(levels).toContain("high");
  });

  it("a request asking for xhigh goes out at the highest level the gateway takes", () => {
    // This is the observable behaviour the 400 came from: the emitted
    // reasoning_effort, not the level list.
    const body = {};
    applyThinking("openai", `${MODEL}(xhigh)`, body, "cloudflare-ai");
    expect(body.reasoning_effort).toBe("high");
  });

  it("the levels the gateway does take are passed through untouched", () => {
    for (const l of ["low", "medium", "high"]) {
      const body = {};
      applyThinking("openai", `${MODEL}(${l})`, body, "cloudflare-ai");
      expect(body.reasoning_effort).toBe(l);
    }
  });

  it("the same request on the OpenAI provider keeps xhigh", () => {
    const body = {};
    applyThinking("openai", "gpt-5.5(xhigh)", body, "openai");
    expect(body.reasoning_effort).toBe("xhigh");
  });

  it("the OpenAI provider itself still offers xhigh", () => {
    // The fix is scoped to the gateway; it must not narrow the ladder for the
    // provider the ladder was written for.
    expect(getThinkingLevels("openai", "gpt-5.5")).toContain("xhigh");
  });

  it("it applies to every cloudflare-ai model, not just the kimi ones", () => {
    // The 400 is the gateway's validator, so it does not depend on which
    // upstream vendor the model id names.
    const levels = getThinkingLevels("cloudflare-ai", "@cf/deepseek-ai/deepseek-v4-flash");
    if (levels) expect(levels).not.toContain("xhigh");
  });
});
