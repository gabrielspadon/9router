// G6 effort scope. The predecessor correction narrowed reasoning-level
// resolution so a GATEWAY's declared enum wins over inference from the model
// id. Today's tree already applies that to capability-derived formats
// (thinkingUnified.resolveFormat and getThinkingLevels agree on the precedence
// provider format > openai-compatible node > per-model caps), but the same
// inversion survived one rung lower, in PATTERN_THINKING: the unscoped
// `*codex*` entry carries no `provider`, so it matched on the model NAME and
// outranked the route's own enum. OpenCode's picker consequently offered
// `xhigh` — which its gateway rejects — and lost `max` and `none`, which it
// accepts. The narrowing is scoped precisely: a pattern entry that names a
// provider is route-scoped and still wins, and a provider that declares no
// gateway format is untouched.
import { describe, expect, it } from "vitest";
import { getThinkingLevels } from "../../../open-sse/providers/thinkingLevels.js";
import { applyThinking } from "../../../open-sse/translator/concerns/thinkingUnified.js";
import { PROVIDERS } from "../../../open-sse/providers/index.js";

const CODEX_LADDER = ["low", "medium", "high", "xhigh"];

function effortOnWire(provider, model, level) {
  const body = applyThinking(
    "openai-chat",
    model,
    { model, reasoning_effort: level },
    provider,
  );
  return body.reasoning_effort;
}

describe("G6 a gateway enum outranks the model name", () => {
  it("gives opencode its own ladder for a codex-named model", () => {
    const levels = getThinkingLevels("opencode", "gpt-5.6-codex");
    expect(levels).toEqual(["none", "low", "medium", "high", "max"]);
    // The precise inversion: the gateway takes `max` and rejects `xhigh`, and
    // the codex ladder is the exact inverse of that.
    expect(levels).toContain("max");
    expect(levels).not.toContain("xhigh");
  });

  it("matches what the same route resolves for a non-codex model", () => {
    // Route-derived means the model id changes nothing on this gateway.
    expect(getThinkingLevels("opencode", "gpt-5.6-codex")).toEqual(
      getThinkingLevels("opencode", "gpt-5.6-sol"),
    );
  });

  it("is wire-visible, not only a picker label", () => {
    // Unclamped, `xhigh` would leave as-is and the gateway would reject it.
    expect(effortOnWire("opencode", "gpt-5.6-codex", "xhigh")).toBe("max");
    expect(effortOnWire("opencode", "gpt-5.6-codex", "max")).toBe("max");
  });

  it.each([
    ["meta", "meta"],
    ["ollama", "ollama"],
    ["tokenrouter", "tokenrouter"],
    ["openrouter", "openai"],
    ["vercel-ai-gateway", "openai"],
    ["venice", "openai"],
    ["nube", "openai"],
    ["siliconflow", "openai"],
  ])("%s serves a codex-named model on its own %s enum", (provider) => {
    const model = "gpt-5.6-codex";
    expect(PROVIDERS[provider].thinkingFormat).toBeTruthy();
    expect(getThinkingLevels(provider, model)).toEqual(
      getThinkingLevels(provider, "gpt-5.6-sol"),
    );
    expect(getThinkingLevels(provider, model)).not.toEqual(CODEX_LADDER);
  });

  it("applies to an openai-compatible node, which declares no PROVIDERS entry", () => {
    // #2752: these speak OpenAI's wire whatever their ids look like.
    expect(getThinkingLevels("openai-compatible-somehost", "gpt-5.6-codex")).toEqual(
      getThinkingLevels("openai-compatible-somehost", "gpt-5.6-sol"),
    );
    expect(getThinkingLevels("openai-compatible-somehost", "gpt-5.6-codex")).not.toEqual(
      CODEX_LADDER,
    );
  });
});

describe("G6 the narrowing stops exactly where it should", () => {
  it.each(["codex", "openai", "kiro"])(
    "leaves %s, which declares no gateway format, on the codex ladder",
    (provider) => {
      expect(PROVIDERS[provider]?.thinkingFormat).toBeFalsy();
      expect(getThinkingLevels(provider, "gpt-5.6-codex")).toEqual(CODEX_LADDER);
    },
  );

  it("keeps a PROVIDER-SCOPED pattern authoritative over the route format", () => {
    // cloudflare-ai declares thinkingFormat "openai" (which carries xhigh), and
    // its provider-scoped pattern exists precisely because its own validator
    // rejects xhigh. A route-format rule that swallowed scoped entries too would
    // regress #2665.
    expect(PROVIDERS["cloudflare-ai"].thinkingFormat).toBe("openai");
    const levels = getThinkingLevels("cloudflare-ai", "gpt-oss-120b");
    expect(levels).not.toContain("xhigh");
    expect(levels).toEqual(["none", "minimal", "low", "medium", "high"]);
  });

  it("keeps ollama's gpt-oss pattern narrowing its own gateway enum", () => {
    // Scoped to the provider, so it still wins: Ollama's docs stop at high.
    expect(getThinkingLevels("ollama", "gpt-oss-20b")).toEqual([
      "none",
      "low",
      "medium",
      "high",
    ]);
  });

  it("keeps codex's own per-model patterns intact", () => {
    // codex/*gpt-5.6-sol* is both provider-scoped and on a provider with no
    // declared gateway format, so neither half of the narrowing reaches it.
    expect(getThinkingLevels("codex", "gpt-5.6-sol")).toContain("ultra");
    expect(getThinkingLevels("codex", "gpt-5.6-luna")).not.toContain("ultra");
  });

  it("returns null for a model with no reasoning capability at all", () => {
    expect(getThinkingLevels("opencode", "text-embedding-3-small")).toBeNull();
  });
});
