import { describe, it, expect } from "vitest";
import { getImageAdapter } from "open-sse/handlers/imageProviders/index.js";
import { PROVIDER_MEDIA } from "open-sse/providers/index.js";

const xai = getImageAdapter("xai");
const EDIT_MODEL = PROVIDER_MEDIA.xai.imageEditConfig.models[0];
const GEN = { prompt: "a cat" };
const EDIT = { prompt: "make it blue", image: "data:image/png;base64,AAA" };

describe("an edit reaches the edit endpoint with its image (#1608)", () => {
  it("a generation is unchanged", () => {
    expect(xai.buildUrl(EDIT_MODEL, {}, GEN)).toBe(PROVIDER_MEDIA.xai.imageConfig.baseUrl);
    expect(xai.buildBody(EDIT_MODEL, GEN).image).toBeUndefined();
  });

  it("an edit goes to the edit endpoint", () => {
    expect(xai.buildUrl(EDIT_MODEL, {}, EDIT)).toBe(PROVIDER_MEDIA.xai.imageEditConfig.baseUrl);
  });

  it("the source image travels, which is the whole point of the request", () => {
    const body = xai.buildBody(EDIT_MODEL, EDIT);
    expect(body.image).toBe(EDIT.image);
    expect(body.prompt).toBe("make it blue");
  });

  it("the edit entry's own field whitelist decides the rest", () => {
    // xAI's edit endpoint accepts model, prompt and image only.
    expect(Object.keys(xai.buildBody(EDIT_MODEL, { ...EDIT, n: 3, size: "1024x1024" })).sort())
      .toEqual(["image", "model", "prompt"]);
  });

  it("takes the first of several images and carries the rest", () => {
    const body = xai.buildBody(EDIT_MODEL, { prompt: "p", images: ["a", "b"] });
    expect(body.image).toBe("a");
  });

  it("a model the edit endpoint does not list stays on generation", () => {
    // A declared endpoint that does not serve the model would turn a working
    // generation into a 404.
    expect(xai.buildUrl("grok-not-listed", {}, EDIT)).toBe(PROVIDER_MEDIA.xai.imageConfig.baseUrl);
  });

  it("a provider with no edit endpoint is untouched", () => {
    const openai = getImageAdapter("openai");
    expect(PROVIDER_MEDIA.openai?.imageEditConfig).toBeUndefined();
    expect(openai.buildUrl("gpt-image-1", {}, EDIT)).toBe(PROVIDER_MEDIA.openai.imageConfig.baseUrl);
  });
});
