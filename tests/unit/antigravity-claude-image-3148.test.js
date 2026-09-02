import { describe, expect, it } from "vitest";
import { openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

// The Claude-on-Antigravity envelope walked content blocks handling only text,
// tool_use and tool_result, so an image block was silently dropped and the model
// answered as if no image had been sent.
const withImage = (block) => ({
  model: "claude-sonnet-4.5",
  messages: [{ role: "user", content: [{ type: "text", text: "what is this?" }, block] }],
});
const allParts = (out) => JSON.stringify(out);

const B64 = { type: "image", source: { type: "base64", media_type: "image/png", data: "IMGDATA" } };
const URLIMG = { type: "image", source: { type: "url", url: "https://example.com/a.png", media_type: "image/png" } };

describe("a Claude image survives the Antigravity envelope (#3148)", () => {
  it("carries base64 image data through", () => {
    const out = openaiToAntigravityRequest("claude-sonnet-4.5", withImage(B64), false);
    expect(allParts(out)).toContain("IMGDATA");
  });

  it("uses the inlineData shape the rest of the translator builds", () => {
    const out = openaiToAntigravityRequest("claude-sonnet-4.5", withImage(B64), false);
    const s = allParts(out);
    expect(s).toContain("inlineData");
    expect(s).toContain("mime_type");
    expect(s).toContain("image/png");
  });

  it("carries a url image as fileData", () => {
    const out = openaiToAntigravityRequest("claude-sonnet-4.5", withImage(URLIMG), false);
    const s = allParts(out);
    expect(s).toContain("fileData");
    expect(s).toContain("https://example.com/a.png");
  });

  it("keeps the accompanying text", () => {
    const out = openaiToAntigravityRequest("claude-sonnet-4.5", withImage(B64), false);
    expect(allParts(out)).toContain("what is this?");
  });

  it("drops nothing when the image block carries no usable source", () => {
    const out = openaiToAntigravityRequest("claude-sonnet-4.5",
      withImage({ type: "image", source: {} }), false);
    expect(allParts(out)).toContain("what is this?");
  });

  it("leaves a non-claude model on the gemini path untouched", () => {
    const out = openaiToAntigravityRequest("gemini-3-flash", {
      model: "gemini-3-flash",
      messages: [{ role: "user", content: "hi" }],
    }, false);
    expect(out).toBeTruthy();
  });

  it("carries an OpenAI-shaped image on the claude path too (#2014)", () => {
    // A client sending image_url is converted to a Claude image block before the
    // envelope runs, so the same branch has to catch it. #2014 reports this
    // symptom without naming a model.
    const out = openaiToAntigravityRequest("claude-sonnet-4.5", {
      model: "claude-sonnet-4.5",
      messages: [{ role: "user", content: [
        { type: "text", text: "what is this?" },
        { type: "image_url", image_url: { url: "data:image/png;base64,IMGDATA" } },
      ] }],
    }, false);
    expect(allParts(out)).toContain("IMGDATA");
  });

  it("the gemini-model path already carried images, which is why this was model-specific", () => {
    const out = openaiToAntigravityRequest("gemini-3-flash", {
      model: "gemini-3-flash",
      messages: [{ role: "user", content: [
        { type: "image_url", image_url: { url: "data:image/png;base64,IMGDATA" } },
      ] }],
    }, false);
    expect(allParts(out)).toContain("IMGDATA");
  });
});
