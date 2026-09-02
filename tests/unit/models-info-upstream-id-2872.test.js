import { describe, expect, it } from "vitest";
import { buildInfo } from "@/app/api/v1/models/info/route.js";

// A TokenProxy model id and the id the upstream receives differ whenever a registry
// row sets upstreamModelId — tiered variants, review models, vendor-prefixed
// ids. Nothing surfaced the mapping, so a caller could not tell which upstream
// model a TokenProxy id resolves to (#2872).
describe("/v1/models/info exposes the upstream model id (#2872)", () => {
  const base = { alias: "ag", providerId: "antigravity", kind: "llm" };

  it("emits it when the row remaps the id", () => {
    const out = buildInfo({
      ...base,
      model: { id: "gemini-3.7-flash-high", name: "x", upstreamModelId: "gemini-3.7-flash-tiered(high)" },
    });
    expect(out.upstreamModelId).toBe("gemini-3.7-flash-tiered(high)");
    expect(out.id).toBe("ag/gemini-3.7-flash-high");
  });

  it("omits it when the ids are the same, so the common case does not grow", () => {
    const out = buildInfo({ ...base, model: { id: "gemini-3.7-flash", name: "x", upstreamModelId: "gemini-3.7-flash" } });
    expect(out).not.toHaveProperty("upstreamModelId");
  });

  it("omits it when the row declares none", () => {
    const out = buildInfo({ ...base, model: { id: "gemini-3.7-flash", name: "x" } });
    expect(out).not.toHaveProperty("upstreamModelId");
  });

  it("the rest of the payload is unchanged", () => {
    const out = buildInfo({ ...base, model: { id: "m", name: "M", upstreamModelId: "u" } });
    expect(out.id).toBe("ag/m");
    expect(out.name).toBe("M");
    expect(out.kind).toBe("llm");
    expect(out.owned_by).toBe("ag");
    expect(out.endpoint).toBe("/v1/chat/completions");
  });

  it("a real registry row is the shape this relies on", async () => {
    const { default: REGISTRY } = await import("open-sse/providers/registry/index.js");
    const ag = REGISTRY.find((r) => r.id === "antigravity");
    expect(ag.models.some((m) => m.upstreamModelId && m.upstreamModelId !== m.id)).toBe(true);
  });
});
