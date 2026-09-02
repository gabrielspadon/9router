import { describe, expect, it } from "vitest";
import createOpenAIEmbeddingAdapter from "open-sse/handlers/embeddingProviders/openai.js";

// NVIDIA's asymmetric embedding model answers 400 "'input_type' parameter is
// required for asymmetric models" when the field is absent. Every generic
// OpenAI client omits it, because the field is not in the OpenAI schema, so the
// model was unusable through TokenProxy (#1378). The registry already declared
// which models require it and nothing read that declaration.
describe("a required embedding parameter is defaulted, not dropped (#1378)", () => {
  const nvidia = createOpenAIEmbeddingAdapter("nvidia");

  it("defaults input_type for the model that declares it required", () => {
    const body = nvidia.buildBody("nvidia/nv-embedqa-e5-v5", { input: "hello" });
    expect(body.input_type).toBe("query");
  });

  it("accepts the bare id as well as the vendor-prefixed one", () => {
    expect(nvidia.buildBody("nv-embedqa-e5-v5", { input: "x" }).input_type).toBe("query");
  });

  it("a client that knows the field still wins", () => {
    const body = nvidia.buildBody("nvidia/nv-embedqa-e5-v5", { input: "x", input_type: "passage" });
    expect(body.input_type).toBe("passage");
  });

  it("a model that does not declare it gets no input_type at all", () => {
    // The default is scoped by the registry declaration, so it cannot leak onto
    // a symmetric model whose upstream would reject the unknown field.
    const openai = createOpenAIEmbeddingAdapter("openai");
    const body = openai.buildBody("text-embedding-3-small", { input: "x" });
    expect(body.input_type).toBeUndefined();
  });

  it("an unknown model on a declaring provider is left alone", () => {
    expect(nvidia.buildBody("nvidia/not-a-real-model", { input: "x" }).input_type).toBeUndefined();
  });

  it("the rest of the body is unchanged", () => {
    const body = nvidia.buildBody("nvidia/nv-embedqa-e5-v5", {
      input: "hello", encoding_format: "float", dimensions: 1024,
    });
    expect(body).toMatchObject({ model: "nvidia/nv-embedqa-e5-v5", input: "hello", encoding_format: "float", dimensions: 1024 });
  });
});
