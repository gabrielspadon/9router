import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(), getProviderConnections: vi.fn(), updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(), toConnectionProxyOptions: vi.fn(),
}));
vi.mock("@/app/api/usage/[connectionId]/route.js", () => ({ refreshAndUpdateCredentials: vi.fn() }));

const { claudePingCandidates, isClaudeModelRejection } =
  await import("@/shared/services/quotaAutoPing");

describe("Claude auto-ping candidate list (#2592)", () => {
  it("tries the configured model first", () => {
    expect(claudePingCandidates({ pingModel: "configured-one" })[0]).toBe("configured-one");
  });

  it("falls back to the models this fork actually routes for Claude", () => {
    const list = claudePingCandidates({ pingModel: "configured-one" });
    // PROVIDER_MODELS is keyed by the registry alias, so a lookup on the
    // provider id alone would give an empty list and no fallback at all.
    expect(list.length).toBeGreaterThan(1);
    expect(list).toContain("claude-haiku-4-5-20251001");
  });

  it("prefers a haiku before the larger models, so the ping stays cheap", () => {
    const list = claudePingCandidates({ pingModel: "configured-one" });
    const firstHaiku = list.findIndex((m) => m.includes("haiku"));
    const firstOpus = list.findIndex((m) => m.includes("opus"));
    expect(firstHaiku).toBeGreaterThan(-1);
    expect(firstOpus === -1 || firstHaiku < firstOpus).toBe(true);
  });

  it("lists each model once", () => {
    const list = claudePingCandidates({ pingModel: "claude-haiku-4-5-20251001" });
    expect(new Set(list).size).toBe(list.length);
  });
});

describe("only a model-level refusal walks the catalogue (#2592)", () => {
  it("treats a 404 as this model being refused", () => {
    expect(isClaudeModelRejection(404, "")).toBe(true);
  });

  it("treats a 400 naming the model as a model refusal", () => {
    expect(isClaudeModelRejection(400, '{"error":{"message":"model: unknown"}}')).toBe(true);
  });

  it("does not walk on an auth or rate-limit failure", () => {
    // Walking here would ping every model in turn against a limiter that is
    // already refusing, which is exactly what a rate limit is asking us not to do.
    for (const status of [401, 403, 429, 500, 529]) {
      expect(isClaudeModelRejection(status, "whatever"), String(status)).toBe(false);
    }
  });

  it("does not walk on a 400 that is about the request rather than the model", () => {
    expect(isClaudeModelRejection(400, '{"error":{"message":"max_tokens is too large"}}')).toBe(false);
  });
});
