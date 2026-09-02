/**
 * POST /v1/images/edits — request normalization and delegation (#2718).
 *
 * The route reuses the generation pipeline for auth/credentials/fallback, so
 * these cover the piece that is genuinely new: turning an OpenAI-compatible
 * multipart or JSON edit request into the internal image body shape, and the
 * validation boundary around it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Buffer } from "node:buffer";

const mocks = vi.hoisted(() => ({ handleImageGeneration: vi.fn() }));
vi.mock("../../src/sse/handlers/imageGeneration.js", () => ({
  handleImageGeneration: mocks.handleImageGeneration,
}));

const { buildImageEditBody, handleImageEdits } = await import("../../src/sse/handlers/imageEdits.js");

const png = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const jpeg = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const webp = () => Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]);
const notAnImage = () => Buffer.from("this is plain text, not an image", "utf8");

const dataUrl = (mime, buf) => `data:${mime};base64,${buf.toString("base64")}`;

function multipart(entries) {
  const form = new FormData();
  for (const [key, value] of entries) form.append(key, value);
  return new Request("http://localhost/v1/images/edits", { method: "POST", body: form });
}

function json(body, headers = {}) {
  return new Request("http://localhost/v1/images/edits", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const file = (buf, name, type) => new File([buf], name, { type });

describe("buildImageEditBody — multipart", () => {
  it("accepts a single `image` file and preserves the sniffed MIME type", async () => {
    const result = await buildImageEditBody(multipart([
      ["model", "cx/gpt-5.5-image"],
      ["prompt", "golden hour"],
      ["size", "1024x1024"],
      ["image", file(webp(), "ref.webp", "image/webp")],
    ]));

    expect(result.error).toBeUndefined();
    expect(result.body.model).toBe("cx/gpt-5.5-image");
    expect(result.body.prompt).toBe("golden hour");
    expect(result.body.size).toBe("1024x1024");
    expect(result.body.image).toBe(dataUrl("image/webp", webp()));
    expect(result.body.images).toBeUndefined();
  });

  it("sniffs the real format rather than trusting the declared Content-Type", async () => {
    const result = await buildImageEditBody(multipart([
      ["model", "cx/gpt-5.5-image"],
      ["prompt", "p"],
      ["image", file(jpeg(), "lying.png", "image/png")],
    ]));

    expect(result.body.image.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("accepts the `image[]` convention and splits refs so codex sees no duplicate", async () => {
    const result = await buildImageEditBody(multipart([
      ["model", "cx/gpt-5.5-image"],
      ["prompt", "merge these"],
      ["image[]", file(png(), "a.png", "image/png")],
      ["image[]", file(jpeg(), "b.jpg", "image/jpeg")],
    ]));

    expect(result.body.images).toEqual([dataUrl("image/png", png())]);
    expect(result.body.image).toBe(dataUrl("image/jpeg", jpeg()));
    // codex appends `image` after `images`, so the pair restores upload order.
    expect([...result.body.images, result.body.image]).toHaveLength(2);
  });

  it("coerces numeric multipart fields", async () => {
    const result = await buildImageEditBody(multipart([
      ["model", "cx/gpt-5.5-image"],
      ["prompt", "p"],
      ["n", "2"],
      ["output_compression", "80"],
      ["image", file(png(), "a.png", "image/png")],
    ]));

    expect(result.body.n).toBe(2);
    expect(result.body.output_compression).toBe(80);
  });

  it("rejects a mask instead of silently dropping it", async () => {
    const result = await buildImageEditBody(multipart([
      ["model", "cx/gpt-5.5-image"],
      ["prompt", "p"],
      ["image", file(png(), "a.png", "image/png")],
      ["mask", file(png(), "m.png", "image/png")],
    ]));

    expect(result.status).toBe(400);
    expect(result.error).toMatch(/mask is not supported/i);
  });

  it("rejects a non-image upload", async () => {
    const result = await buildImageEditBody(multipart([
      ["model", "cx/gpt-5.5-image"],
      ["prompt", "p"],
      ["image", file(notAnImage(), "a.txt", "image/png")],
    ]));

    expect(result.status).toBe(400);
    expect(result.error).toMatch(/Unsupported image format/i);
  });
});

describe("buildImageEditBody — JSON", () => {
  it("accepts images[].image_url as a data URL", async () => {
    const result = await buildImageEditBody(json({
      model: "cx/gpt-5.5-image",
      prompt: "p",
      images: [{ image_url: dataUrl("image/jpeg", jpeg()) }],
    }));

    expect(result.body.image).toBe(dataUrl("image/jpeg", jpeg()));
  });

  it("accepts a bare base64 `image` string", async () => {
    const result = await buildImageEditBody(json({
      model: "cx/gpt-5.5-image",
      prompt: "p",
      image: png().toString("base64"),
    }));

    expect(result.body.image).toBe(dataUrl("image/png", png()));
  });

  it("rejects a remote URL rather than fetching it (SSRF)", async () => {
    const result = await buildImageEditBody(json({
      model: "cx/gpt-5.5-image",
      prompt: "p",
      image: "http://127.0.0.1:20128/internal",
    }));

    expect(result.status).toBe(400);
    expect(result.error).toMatch(/Remote image URLs are not accepted/i);
  });

  it("rejects file_id explicitly", async () => {
    const result = await buildImageEditBody(json({
      model: "cx/gpt-5.5-image",
      prompt: "p",
      images: [{ file_id: "file-abc" }],
    }));

    expect(result.status).toBe(400);
    expect(result.error).toMatch(/file_id/i);
  });

  it("requires model, prompt and at least one image", async () => {
    const noPrompt = await buildImageEditBody(json({ model: "cx/gpt-5.5-image", image: png().toString("base64") }));
    expect(noPrompt.status).toBe(400);
    expect(noPrompt.error).toMatch(/prompt/i);

    const noImage = await buildImageEditBody(json({ model: "cx/gpt-5.5-image", prompt: "p" }));
    expect(noImage.status).toBe(400);
    expect(noImage.error).toMatch(/image/i);

    const noModel = await buildImageEditBody(json({ prompt: "p", image: png().toString("base64") }));
    expect(noModel.status).toBe(400);
    expect(noModel.error).toMatch(/model/i);
  });

  it("refuses an oversized request before reading the body", async () => {
    const result = await buildImageEditBody(json(
      { model: "cx/gpt-5.5-image", prompt: "p", image: png().toString("base64") },
      { "content-length": String(64 * 1024 * 1024) },
    ));

    expect(result.status).toBe(413);
  });

  it("rejects an unsupported Content-Type", async () => {
    const request = new Request("http://localhost/v1/images/edits", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "hello",
    });

    const result = await buildImageEditBody(request);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/Unsupported Content-Type/i);
  });

  it("rejects a malformed JSON body", async () => {
    const request = new Request("http://localhost/v1/images/edits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });

    const result = await buildImageEditBody(request);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/Invalid JSON body/i);
  });
});

describe("handleImageEdits", () => {
  beforeEach(() => {
    mocks.handleImageGeneration.mockReset();
    mocks.handleImageGeneration.mockResolvedValue(new Response("{}", { status: 200 }));
  });

  it("forwards a JSON body and the caller's auth headers to the generation path", async () => {
    const request = multipart([
      ["model", "cx/gpt-5.5-image"],
      ["prompt", "golden hour"],
      ["image", file(png(), "a.png", "image/png")],
    ]);
    request.headers.set("authorization", "Bearer sk-tokenproxy");
    request.headers.set("x-connection-id", "conn-7");

    await handleImageEdits(request);

    expect(mocks.handleImageGeneration).toHaveBeenCalledTimes(1);
    const forwarded = mocks.handleImageGeneration.mock.calls[0][0];
    expect(forwarded.headers.get("content-type")).toBe("application/json");
    expect(forwarded.headers.get("authorization")).toBe("Bearer sk-tokenproxy");
    expect(forwarded.headers.get("x-connection-id")).toBe("conn-7");

    const body = await forwarded.json();
    expect(body.model).toBe("cx/gpt-5.5-image");
    expect(body.prompt).toBe("golden hour");
    expect(body.image).toBe(dataUrl("image/png", png()));
  });

  it("returns the validation error without touching the generation path", async () => {
    const response = await handleImageEdits(json({ model: "cx/gpt-5.5-image", prompt: "p" }));

    expect(response.status).toBe(400);
    expect(mocks.handleImageGeneration).not.toHaveBeenCalled();
  });
});
