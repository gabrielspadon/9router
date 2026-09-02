import { describe, it, expect } from "vitest";
import { getImageAdapter } from "open-sse/handlers/imageProviders/index.js";
import { PROVIDER_MEDIA } from "open-sse/providers/index.js";

const adapter = getImageAdapter("minimax");

describe("MiniMax image generation uses its own API (#2482)", () => {
  it("posts to the image generation path, not the OpenAI one", () => {
    const url = adapter.buildUrl();
    expect(url).toBe("https://api.minimax.io/v1/image_generation");
    // The OpenAI path on the chat host is what returned the 404 page.
    expect(url).not.toContain("/images/generations");
    expect(PROVIDER_MEDIA.minimax.imageConfig.baseUrl).toBe(url);
  });

  it("sends an aspect ratio, because the API takes no WxH size", () => {
    const body = adapter.buildBody("image-01", { prompt: "a cat", size: "1792x1024" });
    expect(body).toEqual({ model: "image-01", prompt: "a cat", n: 1, aspect_ratio: "16:9" });
    expect(body.size).toBeUndefined();
  });

  it("passes an explicit aspect ratio through, and rejects one the API does not accept", () => {
    expect(adapter.buildBody("m", { prompt: "p", aspect_ratio: "21:9" }).aspect_ratio).toBe("21:9");
    expect(adapter.buildBody("m", { prompt: "p", aspect_ratio: "7:5" }).aspect_ratio).toBe("1:1");
  });

  it("clamps the count to the documented range", () => {
    expect(adapter.buildBody("m", { prompt: "p", n: 0 }).n).toBe(1);
    expect(adapter.buildBody("m", { prompt: "p", n: 99 }).n).toBe(9);
    expect(adapter.buildBody("m", { prompt: "p", n: "3" }).n).toBe(3);
    expect(adapter.buildBody("m", { prompt: "p", n: "many" }).n).toBe(1);
  });

  it("sends the key as a bearer token", () => {
    expect(adapter.buildHeaders({ apiKey: "k" }).Authorization).toBe("Bearer k");
    expect(adapter.buildHeaders({ accessToken: "t" }).Authorization).toBe("Bearer t");
  });

  for (const [name, body] of [
    ["an array of objects with a url", { data: [{ url: "https://i/1.png" }] }],
    ["an array of bare strings", { data: ["https://i/1.png"] }],
    ["an object of image urls", { data: { image_urls: ["https://i/1.png"] } }],
  ]) {
    it(`reads ${name}, because the shape is not consistent across MiniMax and its proxies`, () => {
      const out = adapter.normalize(body);
      expect(out.data).toEqual([{ url: "https://i/1.png" }]);
      expect(out.created).toBeGreaterThan(0);
    });
  }

  it("treats a non-url string as base64 rather than as a url", () => {
    expect(adapter.normalize({ data: ["iVBORw0KGgo="] }).data).toEqual([{ b64_json: "iVBORw0KGgo=" }]);
  });

  it("passes an already-OpenAI-shaped body straight through", () => {
    const already = { created: 123, data: [{ url: "https://i/1.png" }] };
    expect(adapter.normalize(already)).toBe(already);
  });

  it("raises when the status envelope reports a failure on an HTTP 200", () => {
    // MiniMax answers 200 with a non-zero status code; normalizing that into an
    // empty success would report "no images" instead of the real reason.
    expect(() => adapter.normalize({ base_resp: { status_code: 1004, status_msg: "invalid api key" } }))
      .toThrow(/invalid api key/);
  });

  it("returns no images rather than throwing on an unrecognised body", () => {
    expect(adapter.normalize({}).data).toEqual([]);
  });
});
