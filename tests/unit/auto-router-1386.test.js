// Issue #1386: one virtual model id whose model is chosen per request, the way
// OpenRouter's auto router works. The cost it exists to save is real: today a
// greeting and an architecture question both go to whatever single model the
// client was configured with. The router only picks a model string and hands it
// back to the normal path, so nothing downstream changes shape.
import { describe, expect, it, vi, beforeEach } from "vitest";

const models = [
  { id: "cheap/tiny", owned_by: "cheap" },
  { id: "mid/workhorse", owned_by: "mid" },
  { id: "big/flagship", owned_by: "big" },
  { id: "cheap/second", owned_by: "cheap" },
  { id: "combo/mine", owned_by: "combo" },
];

const prices = {
  "cheap/tiny": 0.5,
  "cheap/second": 0.8,
  "mid/workhorse": 3,
  "big/flagship": 15,
};

let unavailable = [];

vi.mock("@/app/api/v1/models/route.js", () => ({ buildModelsList: async () => models }));
vi.mock("@/app/api/models/availability/route.js", () => ({
  GET: async () => ({ ok: true, json: async () => ({ models: unavailable }) }),
}));
vi.mock("open-sse/providers/pricing.js", () => ({
  getPricingForModel: (provider, model) => {
    const output = prices[`${provider}/${model}`];
    return output === undefined ? null : { output };
  },
}));
vi.mock("open-sse/providers/capabilities.js", () => ({
  getCapabilitiesForModel: () => ({ contextWindow: 128000 }),
}));

const { classifyTask, resolveAutoModel, AUTO_MODEL_IDS } = await import("@/sse/services/autoRouter.js");

beforeEach(() => { unavailable = []; });

describe("task classification (#1386)", () => {
  it("a greeting is simple", () => {
    expect(classifyTask({ messages: [{ role: "user", content: "hi there" }] })).toBe("simple");
  });

  it("a tool-bearing request is coding whatever the text says", () => {
    const body = { messages: [{ role: "user", content: "hi" }], tools: [{ type: "function" }] };
    expect(classifyTask(body)).toBe("coding");
  });

  it("a code fence is coding", () => {
    expect(classifyTask({ messages: [{ role: "user", content: "fix this\n```js\nx()\n```" }] })).toBe("coding");
  });

  it("an architecture question is reasoning", () => {
    expect(classifyTask({ messages: [{ role: "user", content: "what are the trade-offs here" }] })).toBe("reasoning");
  });

  it("a very long prompt is reasoning whatever it says", () => {
    expect(classifyTask({ messages: [{ role: "user", content: "hello ".repeat(2000) }] })).toBe("reasoning");
  });

  it("reads a Responses-shaped body too", () => {
    expect(classifyTask({ input: "what are the trade-offs here" })).toBe("reasoning");
  });

  it("reads multimodal content blocks", () => {
    const body = { messages: [{ role: "user", content: [{ type: "text", text: "```py\nx\n```" }] }] };
    expect(classifyTask(body)).toBe("coding");
  });
});

describe("model selection (#1386)", () => {
  it("routes a greeting to the cheapest budget model", async () => {
    const r = await resolveAutoModel({ messages: [{ role: "user", content: "hi" }] }, {});
    expect(r).toEqual({ model: "cheap/tiny", taskClass: "simple", source: "tier" });
  });

  it("routes reasoning to the top tier", async () => {
    const r = await resolveAutoModel({ messages: [{ role: "user", content: "analyze the trade-offs" }] }, {});
    expect(r.model).toBe("big/flagship");
  });

  it("routes coding to the standard tier", async () => {
    const r = await resolveAutoModel({ messages: [{ role: "user", content: "```js\nx()\n```" }] }, {});
    expect(r.model).toBe("mid/workhorse");
  });

  it("never routes to a combo, which would recurse", async () => {
    const r = await resolveAutoModel({ messages: [{ role: "user", content: "hi" }] }, {});
    expect(r.model).not.toBe("combo/mine");
  });

  it("skips a model availability reports exhausted", async () => {
    unavailable = [{ provider: "cheap", model: "tiny" }];
    const r = await resolveAutoModel({ messages: [{ role: "user", content: "hi" }] }, {});
    expect(r.model).toBe("cheap/second");
  });

  it("falls to the next tier when the preferred one is empty", async () => {
    unavailable = [{ provider: "cheap", model: "__all" }];
    const r = await resolveAutoModel({ messages: [{ role: "user", content: "hi" }] }, {});
    expect(r.model).toBe("mid/workhorse");
  });

  it("an explicit rule beats the tier pick", async () => {
    const settings = { autoRouter: { rules: { simple: "big/flagship" } } };
    const r = await resolveAutoModel({ messages: [{ role: "user", content: "hi" }] }, settings);
    expect(r).toEqual({ model: "big/flagship", taskClass: "simple", source: "rule" });
  });

  it("ignores a rule that is not a provider/model id", async () => {
    const settings = { autoRouter: { rules: { simple: "flagship" } } };
    const r = await resolveAutoModel({ messages: [{ role: "user", content: "hi" }] }, settings);
    expect(r.source).toBe("tier");
  });

  it("returns null rather than guessing when nothing is routable", async () => {
    unavailable = ["cheap", "mid", "big"].map((provider) => ({ provider, model: "__all" }));
    expect(await resolveAutoModel({ messages: [{ role: "user", content: "hi" }] }, {})).toBeNull();
  });

  it("claims auto-router but never the bare \"auto\"", () => {
    expect(AUTO_MODEL_IDS.has("auto-router")).toBe(true);
    expect(AUTO_MODEL_IDS.has("tokenproxy/auto")).toBe(true);
    // "auto" is a real model name here: Trae uses it as a strategy value and a
    // bare alias resolves through connection defaults, so claiming it would
    // shadow a model the user actually has.
    expect(AUTO_MODEL_IDS.has("auto")).toBe(false);
  });
});
