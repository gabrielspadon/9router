import { describe, expect, it } from "vitest";
import { openaiToKiroRequest } from "open-sse/translator/request/openai-to-kiro.js";
import { openaiToClaudeRequest } from "open-sse/translator/request/openai-to-claude.js";
import { openaiToOllamaRequest } from "open-sse/translator/request/openai-to-ollama.js";
import { openaiToOpenAIResponsesRequest } from "open-sse/translator/request/openai-responses.js";
import { convertOpenAIContentToParts } from "open-sse/translator/formats/gemini.js";
import { extractAiSdkImageUrl } from "open-sse/translator/concerns/image.js";

// The Vercel AI SDK sends multimodal image parts as
// { type: "image", image: "data:image/png;base64,..." }, not OpenAI's
// { type: "image_url", image_url: { url } }. Every OpenAI-input translator that
// only read image_url silently dropped the image (#1330).
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUg==";
const DATA_URI = `data:image/png;base64,${PNG_B64}`;
const aiSdkContent = [
  { type: "text", text: "Describe this image" },
  { type: "image", image: DATA_URI },
];

describe("extractAiSdkImageUrl (#1330)", () => {
  it("reads the AI SDK image string", () => {
    expect(extractAiSdkImageUrl({ type: "image", image: DATA_URI })).toBe(DATA_URI);
  });

  it("does not shadow the Claude-shaped passthrough block", () => {
    expect(extractAiSdkImageUrl({ type: "image", source: { type: "base64", data: PNG_B64 } })).toBeNull();
  });

  it("returns null for anything else", () => {
    expect(extractAiSdkImageUrl({ type: "image_url", image_url: { url: DATA_URI } })).toBeNull();
    expect(extractAiSdkImageUrl(null)).toBeNull();
  });
});

describe("AI SDK image parts survive OpenAI-input translation (#1330)", () => {
  it("Kiro: lands in userInputMessage.images, not text", () => {
    const out = openaiToKiroRequest("kr/claude-sonnet-4.6", {
      messages: [{ role: "user", content: aiSdkContent }],
    }, false, null);
    const images = out.conversationState.currentMessage.userInputMessage.images;
    expect(images).toEqual([{ format: "png", source: { bytes: PNG_B64 } }]);
  });

  it("Claude: becomes a proper image content block", () => {
    const out = openaiToClaudeRequest("claude-sonnet-4.6", {
      messages: [{ role: "user", content: aiSdkContent }],
    }, false);
    const blocks = out.messages[0].content;
    const image = blocks.find((b) => b.type === "image");
    expect(image.source).toEqual({ type: "base64", media_type: "image/png", data: PNG_B64 });
  });

  it("Gemini (formats/gemini.js convertOpenAIContentToParts): becomes inlineData", () => {
    const parts = convertOpenAIContentToParts(aiSdkContent);
    const image = parts.find((p) => p.inlineData);
    expect(image.inlineData).toEqual({ mime_type: "image/png", data: PNG_B64 });
  });

  it("Ollama: raw base64 lands in message.images[]", () => {
    const out = openaiToOllamaRequest("llava", {
      messages: [{ role: "user", content: aiSdkContent }],
    }, false);
    expect(out.messages[0].images).toEqual([PNG_B64]);
  });

  it("OpenAI Responses: becomes input_image", () => {
    const out = openaiToOpenAIResponsesRequest("gpt-5", {
      messages: [{ role: "user", content: aiSdkContent }],
    }, false, null);
    const item = out.input.find((i) => i.role === "user");
    const image = item.content.find((c) => c.type === "input_image");
    expect(image.image_url).toBe(DATA_URI);
  });
});
