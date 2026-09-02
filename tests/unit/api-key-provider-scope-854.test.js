// A per-key allowlist can name models but not a PROVIDER (#854): "openai/gpt-4o"
// is exact and a bare "openai" only ever matched a model literally called
// "openai", so scoping a shared key to one provider meant enumerating every
// model that provider will ever offer. "<provider>/*" closes that with the
// allowlist and the enforcement seam already in place, so every modality that
// already calls refuseDisallowedModel inherits it.
import { describe, it, expect, vi } from "vitest";
import { matchesAllowedModel } from "@/lib/db/repos/apiKeysRepo.js";
import { refuseDisallowedModel } from "@/sse/services/modelAccess.js";

describe("provider-scoped allowlist entries (#854)", () => {
  it("admits every model of the named provider", () => {
    expect(matchesAllowedModel(["openai/*"], "openai/gpt-4o")).toBe(true);
    expect(matchesAllowedModel(["openai/*"], "openai/o4-mini")).toBe(true);
  });

  it("refuses another provider's model", () => {
    expect(matchesAllowedModel(["openai/*"], "anthropic/claude-sonnet-4")).toBe(false);
  });

  it("compares whole provider segments, so a lookalike prefix is not admitted", () => {
    expect(matchesAllowedModel(["openai/*"], "openai-compatible-abc/gpt-4o")).toBe(false);
  });

  it("admits the bare provider string the search and fetch handlers check", () => {
    // handlers/search.js and handlers/fetch.js pass providerInput, not a model.
    expect(matchesAllowedModel(["tavily/*"], "tavily")).toBe(true);
    expect(matchesAllowedModel(["tavily/*"], "exa")).toBe(false);
  });

  it("refuses an unqualified model name, because it names no provider to check", () => {
    expect(matchesAllowedModel(["openai/*"], "gpt-4o")).toBe(false);
  });

  it("still honours exact entries listed beside a provider scope", () => {
    const allowed = ["openai/*", "claude-sonnet-4"];
    expect(matchesAllowedModel(allowed, "openai/gpt-4o")).toBe(true);
    expect(matchesAllowedModel(allowed, "anthropic/claude-sonnet-4")).toBe(true);
    expect(matchesAllowedModel(allowed, "anthropic/claude-opus-4")).toBe(false);
  });

  it("is case-insensitive on both sides, like every other entry", () => {
    expect(matchesAllowedModel(["OpenAI/*"], "openai/GPT-4o")).toBe(true);
  });

  it("a bare '*' is not a wildcard entry, so it cannot silently open a scoped key", () => {
    expect(matchesAllowedModel(["*"], "openai/gpt-4o")).toBe(false);
  });
});

describe("the existing enforcement seam carries the provider scope (#854)", () => {
  it("refuseDisallowedModel answers 403 for a provider outside the scope", async () => {
    vi.resetModules();
    vi.doMock("@/lib/db/repos/apiKeysRepo.js", () => ({
      isModelAllowed: async (_key, model) => matchesAllowedModel(["openai/*"], model),
    }));
    const { refuseDisallowedModel: refuse } = await import("@/sse/services/modelAccess.js");

    expect(await refuse("sk-test", "openai/gpt-4o", null)).toBeNull();
    const barred = await refuse("sk-test", "anthropic/claude-sonnet-4", null);
    expect(barred?.status).toBe(403);
    vi.doUnmock("@/lib/db/repos/apiKeysRepo.js");
  });

  it("is exported and reachable from the shared refusal helper", () => {
    expect(typeof refuseDisallowedModel).toBe("function");
  });
});
