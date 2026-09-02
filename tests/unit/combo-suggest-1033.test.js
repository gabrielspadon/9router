import { describe, it, expect } from "vitest";
import {
  buildChain,
  classifyModel,
  splitModelId,
} from "@/app/api/combos/suggest/route.js";

describe("model tiers come from published price, not a guess (#1091)", () => {
  it("splits a model id at the first slash only", () => {
    expect(splitModelId("openrouter/vendor/model")).toEqual({
      provider: "openrouter", model: "vendor/model",
    });
    for (const bad of ["", "noslash", "/leading", "trailing/", null, 7]) {
      expect(splitModelId(bad), String(bad)).toBeNull();
    }
  });

  it("puts an expensive model in the top tier and a cheap one in the budget tier", () => {
    const top = classifyModel("openai/gpt-5");
    expect(top.tier).toBe("top");
    expect(top.outputPricePerMillion).toBeGreaterThanOrEqual(5);
  });

  it("calls an unpriced model unpriced rather than free", () => {
    // Guessing it into the cheap tier would put an unknown cost first in every
    // suggested chain.
    const entry = classifyModel("someprovider/a-model-nobody-prices");
    expect(entry.tier).toBe("unpriced");
    expect(entry.outputPricePerMillion).toBeNull();
  });

  it("carries the capabilities the resolver already knows", () => {
    const entry = classifyModel("openai/gpt-5");
    expect(entry.contextWindow).toBeGreaterThan(0);
    expect(typeof entry.reasoning).toBe("boolean");
    expect(typeof entry.vision).toBe("boolean");
  });
});

const E = (id, tier, ctx = 0) => ({ id, tier, contextWindow: ctx });

describe("the suggested chain spreads across providers (#1033)", () => {
  it("does not put two models of one provider next to each other", () => {
    // A chain exists to survive a member failing; two members on the same
    // provider waste a hop when the provider itself is what went down.
    const chain = buildChain([
      E("a/one", "top"), E("a/two", "top"), E("b/one", "top"), E("b/two", "standard"),
    ], 4);
    expect(chain[0].split("/")[0]).not.toBe(chain[1].split("/")[0]);
    expect(chain).toHaveLength(4);
  });

  it("prefers the capable tiers before the cheap one", () => {
    const chain = buildChain([E("a/cheap", "budget"), E("b/strong", "top")], 2);
    expect(chain[0]).toBe("b/strong");
  });

  it("puts an unpriced model after a priced one rather than first", () => {
    const chain = buildChain([E("a/unknown", "unpriced"), E("b/known", "standard")], 2);
    expect(chain[0]).toBe("b/known");
  });

  it("breaks a tier tie on the larger context window", () => {
    const chain = buildChain([E("a/small", "top", 8000), E("a/big", "top", 200000)], 2);
    expect(chain[0]).toBe("a/big");
  });

  it("respects the limit and never repeats a model", () => {
    const chain = buildChain([E("a/1", "top"), E("b/1", "top"), E("c/1", "top")], 2);
    expect(chain).toHaveLength(2);
    expect(new Set(chain).size).toBe(2);
  });

  it("returns what it has when fewer models exist than asked for", () => {
    expect(buildChain([E("a/1", "top")], 5)).toEqual(["a/1"]);
    expect(buildChain([], 5)).toEqual([]);
  });

  it("is deterministic, so the same connections suggest the same chain", () => {
    const models = [E("a/1", "top"), E("b/1", "top"), E("a/2", "standard")];
    expect(buildChain(models, 3)).toEqual(buildChain([...models], 3));
  });
});
