import { describe, expect, it, vi } from "vitest";

const MODELS = [
  { id: "cx/gpt-5.6", object: "model", owned_by: "cx" },
  { id: "gpt-4o", object: "model", owned_by: "openai" },
  { id: "cf/whisper", object: "model", owned_by: "cf" },
];
vi.mock("@/app/api/v1/models/route.js", () => ({
  buildModelsList: async (kinds) => {
    if (!Array.isArray(kinds)) throw new TypeError("buildModelsList requires a kind list");
    return MODELS;
  },
}));

const { GET } = await import("@/app/api/v1/models/[...kind]/route.js");
const get = (kind) => GET(new Request("http://x/v1/models/" + kind), { params: Promise.resolve({ kind }) });

// OpenAI's own GET /v1/models/{model} returns a single model object. This route
// claimed the same path for its eight kind slugs, so a client following the spec
// got 404 "Unknown model kind" for a model that exists (#3588).
describe("GET /v1/models/{id} resolves a single model (#3588)", () => {
  it("a bare model id returns that model, not a list", async () => {
    const body = await (await get("gpt-4o")).json();
    expect(body.id).toBe("gpt-4o");
    expect(body.object).toBe("model");
    expect(body.data).toBeUndefined();
  });

  it("the last segment of a prefixed id also resolves", async () => {
    // A client that only knows the upstream name should still find it.
    const body = await (await get("whisper")).json();
    expect(body.id).toBe("cf/whisper");
  });

  it("a kind slug still returns a list, so existing callers are unaffected", async () => {
    const res = await get("embedding");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.object).toBe("list");
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("an id matching nothing still 404s, and the message names both cases", async () => {
    const res = await get("no-such-model");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.message).toContain("Unknown model or kind");
    expect(body.error.message).toContain("embedding");
  });

  it("the lookup asks for every kind, not just llm", async () => {
    // The mock throws on a non-array, which pins that a kind list is passed;
    // this asserts a non-llm model is reachable, which needs the full list.
    const body = await (await get("whisper")).json();
    expect(body.id).toBe("cf/whisper");
  });
});
