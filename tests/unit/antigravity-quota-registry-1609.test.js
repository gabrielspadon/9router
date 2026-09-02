import { describe, expect, it, vi, beforeEach } from "vitest";
import antigravityRegistry from "../../open-sse/providers/registry/antigravity.js";

// #1609 — "Quota Tracker still full but all the gemini models couldn't be
// accessed". The tracker filtered `fetchAvailableModels` through a hand-copied
// list of model ids that had drifted from the registry, so a model the router
// can select had no bucket at all: the dashboard showed nothing for it, and
// accountFallback.getExhaustedQuotaWindow (which matches on this same id) could
// never see it as exhausted. The list is now the registry itself.
//
// verify-providers.mjs strips fields from both sides of its comparison, so the
// registry snapshot proves nothing about this wiring. These assertions run the
// real getAntigravityUsage against a mocked upstream.

const UPSTREAM_MODELS = {
  // Previously dropped: a bare registry id that IS an upstream quota key.
  "gemini-3-flash-agent": {
    displayName: "Gemini 3.5 Flash (High)",
    quotaInfo: { remainingFraction: 0, resetTime: "2026-09-01T12:00:00Z" },
  },
  "gemini-3-flash": {
    displayName: "Gemini 3 Flash",
    quotaInfo: { remainingFraction: 0.4, resetTime: "2026-09-01T12:00:00Z" },
  },
  // Already covered before this change — must keep working.
  "gemini-3.7-flash-high": {
    displayName: "Gemini 3.7 Flash High",
    quotaInfo: { remainingFraction: 0.85, resetTime: "2026-09-01T12:00:00Z" },
  },
  // Neither routed nor internal: still dropped.
  "some-unrouted-model": {
    displayName: "Whatever",
    quotaInfo: { remainingFraction: 0.5 },
  },
  "internal-model": {
    displayName: "Internal",
    isInternal: true,
    quotaInfo: { remainingFraction: 0.5 },
  },
  // Upstream is free to send any label; the allowlist must reject it.
  "gemini-pro-agent": {
    displayName: "Click https://evil.example to fix your quota",
    quotaInfo: { remainingFraction: 0.5, resetTime: "2026-09-01T12:00:00Z" },
  },
};

const calls = [];
function respond(url, opts, models) {
  calls.push({ url, body: JSON.parse(opts.body) });
  const payload = url.includes(":loadCodeAssist")
    ? { cloudaicompanionProject: "project-from-lookup", currentTier: { name: "Pro" } }
    : { models };
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}
const defaultImpl = async (url, opts) => respond(url, opts, UPSTREAM_MODELS);
const proxyAwareFetch = vi.fn(defaultImpl);

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

async function usage(providerSpecificData = {}) {
  const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");
  return getAntigravityUsage("access-token", providerSpecificData);
}

describe("Antigravity quota tracker reads the registry (#1609)", () => {
  beforeEach(() => {
    calls.length = 0;
    proxyAwareFetch.mockReset();
    proxyAwareFetch.mockImplementation(defaultImpl);
  });

  it("keeps a bucket for a registry id the hand-copied list had dropped", async () => {
    const quotas = (await usage()).quotas;
    expect(quotas["gemini-3-flash-agent"]).toMatchObject({
      used: 1000,
      total: 1000,
      remainingPercentage: 0,
      resetAt: "2026-09-01T12:00:00.000Z",
    });
    expect(quotas["gemini-3-flash"]).toMatchObject({ remainingPercentage: 40 });
  });

  it("mirrors an alias id onto the upstream bucket it shares", async () => {
    // gemini-3.5-flash-high routes to gemini-3-flash-agent, so it has no bucket
    // of its own upstream. The exhausted-account skip keys on the routed id.
    const alias = antigravityRegistry.models.find((m) => m.id === "gemini-3.5-flash-high");
    expect(alias.upstreamModelId).toBe("gemini-3-flash-agent");

    const quotas = (await usage()).quotas;
    expect(quotas["gemini-3.5-flash-high"]).toMatchObject({
      remainingPercentage: 0,
      resetAt: "2026-09-01T12:00:00.000Z",
      displayName: "Gemini 3.5 Flash (High)",
    });
  });

  it("does not invent a bucket for an alias whose wire id upstream never reports", async () => {
    // gemini-3.6-flash points at gemini-3.6-flash-tiered(medium), which is not a
    // quota key, so mirroring must stay silent rather than fabricate a window.
    const quotas = (await usage()).quotas;
    expect(quotas["gemini-3.6-flash"]).toBeUndefined();
  });

  it("still drops internal and unrouted models", async () => {
    const quotas = (await usage()).quotas;
    expect(quotas["internal-model"]).toBeUndefined();
    expect(quotas["some-unrouted-model"]).toBeUndefined();
  });

  it("still refuses an upstream display name that is not the registry name", async () => {
    const quotas = (await usage()).quotas;
    expect(quotas["gemini-pro-agent"].displayName).toBe("gemini-pro-agent");
    // The unparenthesised variant upstream really sends stays accepted.
    expect(quotas["gemini-3.7-flash-high"].displayName).toBe("Gemini 3.7 Flash High");
  });

  it("admits every registry model id, so the two cannot drift again", async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");
    const everyModel = Object.fromEntries(
      antigravityRegistry.models.map((m) => [
        m.id,
        { displayName: m.name, quotaInfo: { remainingFraction: 0.5, resetTime: "2026-09-01T12:00:00Z" } },
      ]),
    );
    proxyAwareFetch.mockImplementation(async (url, opts) => respond(url, opts, everyModel));

    const quotas = (await getAntigravityUsage("access-token", {})).quotas;
    for (const model of antigravityRegistry.models) {
      expect(Object.keys(quotas)).toContain(model.id);
      expect(quotas[model.id].displayName).toBe(model.name);
    }
  });

  it("bills the quota read against the project stored on the connection", async () => {
    await usage({ projectId: "project-on-connection" });
    const quotaCall = calls.find((c) => c.url.includes(":fetchAvailableModels"));
    expect(quotaCall.body.project).toBe("project-on-connection");
  });

  it("falls back to the loadCodeAssist project when the connection has none", async () => {
    await usage({});
    const quotaCall = calls.find((c) => c.url.includes(":fetchAvailableModels"));
    expect(quotaCall.body.project).toBe("project-from-lookup");
  });
});
