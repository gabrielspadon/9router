/**
 * Copilot's live catalog publishes each model's real token limits, and the
 * fork threw them away (#2756).
 *
 * `expandCatalog` reduced every entry to `{ id, name }`, so `/v1/models` had
 * no per-model capability data for GitHub and fell back to the static table.
 * For a Copilot-hosted Anthropic model that table carries DIRECT Claude limits
 * — a 1M context window against Copilot's much smaller ceiling — and the route
 * then advertises a window the account cannot use. A client sizing its context
 * from `context_length` never reaches its own compaction threshold and hard-
 * fails upstream, which is the shape #2756 reports.
 *
 * Copilot states the numbers itself in the same response, so nothing has to be
 * hardcoded: carry `capabilities.limits` through, the way the sibling live
 * catalog service already does (services/kimchiModels.js).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));

const { proxyAwareFetch } = await import("open-sse/utils/proxyFetch.js");
const { resolveCopilotModels, clearCopilotModelCache } = await import("open-sse/services/copilotModels.js");

const CREDENTIALS = { providerSpecificData: { copilotToken: "tok" } };

function catalog(data) {
  proxyAwareFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data }) });
}

const entry = (over = {}) => ({
  id: "claude-sonnet-4.5",
  name: "Claude Sonnet 4.5",
  policy: { state: "enabled" },
  capabilities: {
    type: "chat",
    supports: { streaming: true, tool_calls: true, vision: true },
    limits: { max_context_window_tokens: 144000, max_prompt_tokens: 128000, max_output_tokens: 16000 },
  },
  ...over,
});

beforeEach(() => {
  clearCopilotModelCache();
  proxyAwareFetch.mockReset();
});

afterEach(() => {
  clearCopilotModelCache();
});

describe("Copilot live catalog carries its own limits (#2756)", () => {
  it("exposes the published context window and output ceiling", async () => {
    catalog([entry()]);
    const { models } = await resolveCopilotModels(CREDENTIALS);

    expect(models[0].capabilities.contextWindow).toBe(144000);
    expect(models[0].capabilities.maxOutput).toBe(16000);
  });

  it("does not advertise the direct-Claude window for a Copilot-hosted model", async () => {
    catalog([entry()]);
    const { models } = await resolveCopilotModels(CREDENTIALS);

    expect(models[0].capabilities.contextWindow).toBeLessThan(1000000);
  });

  it("keeps id and name, and still filters non-chat and disabled entries", async () => {
    catalog([
      entry(),
      entry({ id: "text-embedding-3", capabilities: { type: "embeddings" } }),
      entry({ id: "blocked", policy: { state: "disabled" } }),
    ]);
    const { models } = await resolveCopilotModels(CREDENTIALS);

    expect(models.map((m) => m.id)).toEqual(["claude-sonnet-4.5"]);
    expect(models[0].name).toBe("Claude Sonnet 4.5");
  });

  it("falls back to the static table when Copilot publishes no limits", async () => {
    catalog([entry({ capabilities: { type: "chat" } })]);
    const { models } = await resolveCopilotModels(CREDENTIALS);

    expect(Number.isFinite(models[0].capabilities.contextWindow)).toBe(true);
  });
});
