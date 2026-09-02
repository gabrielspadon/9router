import { describe, expect, it } from "vitest";
import { splitToolResultMedia } from "open-sse/translator/concerns/image.js";
import { readFileSync } from "node:fs";

const PNG = "iVBORw0KGgoAAAANSUhEUg==";
const read = (p) => readFileSync(new URL(`../../open-sse/translator/request/${p}`, import.meta.url), "utf8");

// Kiro's tool result carries text and nothing else, so every Kiro translator
// mapped an image part to "" and the model answered about a picture it was
// never shown. The Claude translator was worse: an image-only result fell
// through to JSON.stringify and shipped the base64 payload as tool text, paying
// for the tokens without delivering the image (#2521).
describe("images inside a tool result reach Kiro's vision channel (#2521)", () => {
  it("pulls a Claude image block out as an image, not as text", () => {
    const { text, images } = splitToolResultMedia([
      { type: "text", text: "here it is" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } },
    ]);
    expect(images).toEqual([{ format: "png", source: { bytes: PNG } }]);
    expect(text).toContain("here it is");
    expect(text).not.toContain(PNG);
  });

  it("pulls an OpenAI image_url data URI out the same way", () => {
    const { text, images } = splitToolResultMedia([
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${PNG}` } },
    ]);
    expect(images).toEqual([{ format: "jpeg", source: { bytes: PNG } }]);
    expect(text).not.toContain(PNG);
  });

  it("never serialises base64 into the text channel, which is what made it expensive", () => {
    const { text, images } = splitToolResultMedia([
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } },
    ]);
    expect(text).not.toContain(PNG);
    expect(text.length).toBeLessThan(80);
    expect(images).toHaveLength(1);
  });

  it("leaves a remote URL as text, since Kiro takes base64 only", () => {
    const { text, images } = splitToolResultMedia([
      { type: "image_url", image_url: { url: "https://example.com/a.png" } },
    ]);
    expect(images).toEqual([]);
    expect(text).toContain("https://example.com/a.png");
  });

  it("passes a plain string result through untouched", () => {
    expect(splitToolResultMedia("plain output")).toEqual({ text: "plain output", images: [] });
  });

  it("keeps ordinary text-only results exactly as they were", () => {
    const { text, images } = splitToolResultMedia([{ type: "text", text: "a" }, { type: "text", text: "b" }]);
    expect(text).toBe("a\nb");
    expect(images).toEqual([]);
  });

  it("handles several images in one result", () => {
    const { images } = splitToolResultMedia([
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } },
      { type: "image_url", image_url: { url: `data:image/webp;base64,${PNG}` } },
    ]);
    expect(images.map((i) => i.format)).toEqual(["png", "webp"]);
  });

  it("survives a null or empty result without inventing content", () => {
    expect(splitToolResultMedia(null)).toEqual({ text: "", images: [] });
    expect(splitToolResultMedia([])).toEqual({ text: "", images: [] });
  });
});

describe("both Kiro translators use it", () => {
  for (const file of ["openai-to-kiro.js", "claude-to-kiro.js"]) {
    it(`${file} hoists tool-result images into pendingImages`, () => {
      const src = read(file);
      expect(src).toContain("splitToolResultMedia");
      expect(src).toMatch(/pendingImages\.push\(\.\.\./);
    });
  }

  it("claude-to-kiro no longer stringifies a tool result's content array", () => {
    // That fallback is what turned an image-only result into a base64 text dump.
    const src = read("claude-to-kiro.js");
    expect(src).not.toContain("JSON.stringify(block.content)");
  });
});

// Drop point 1 in the same report: the MITM inbound converter read only
// userInputMessage.content, so images the Kiro IDE puts in
// userInputMessage.images died before the request was forwarded. That file is
// CommonJS and exports only `intercept`, so the converter is pinned by source.
describe("the MITM inbound path carries images too (#2521)", () => {
  const mitm = readFileSync(new URL("../../src/mitm/handlers/kiro.js", import.meta.url), "utf8");

  it("reads uim.images", () => {
    expect(mitm).toMatch(/Array\.isArray\(uim\.images\)/);
  });

  it("converts Kiro's { format, source: { bytes } } into a data URI image_url", () => {
    expect(mitm).toContain("kiroImageToOpenAI");
    expect(mitm).toMatch(/data:\$\{mime\};base64,\$\{bytes\}/);
    expect(mitm).toContain('type: "image_url"');
  });

  it("emits a user turn for an image even when there is no text and no tool result", () => {
    expect(mitm).toMatch(/toolResults\.length === 0 \|\| images\.length > 0/);
  });

  it("stops mapping tool-result parts to the empty string", () => {
    expect(mitm).not.toContain('(tr.content || []).map(c => c.text || "")');
  });
});
