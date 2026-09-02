import { describe, expect, it } from "vitest";
import { modelSupportedFormats } from "open-sse/providers/models/schema.js";
import opencodeGo from "open-sse/providers/registry/opencode-go.js";
import { translateRequest } from "open-sse/translator/index.js";

// Codex sends image references as Responses input_image blocks. Kimi K3 on
// OpenCode Go is an OpenAI-compatible Chat Completions model, and with no
// registry entry the route fell to the /responses transport, so the blocks
// stayed in Responses shape and the upstream counted them as an enormous text
// payload: "exceeded model token limit: 1048576, requested: 1300675" on a
// conversation nowhere near that size (#3392).
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

const models = () => opencodeGo.models || [];
const kimiK3 = () => models().find((m) => m.id === "kimi-k3");

describe("opencode-go kimi-k3 is pinned to the Chat wire (#3392)", () => {
  it("the model is registered", () => {
    expect(kimiK3()).toBeTruthy();
  });

  it("it declares openai only, which is what forces the translation", () => {
    // Without supportedFormats the multi-endpoint transport list would pick the
    // /responses endpoint for a Responses client and pass the body through.
    expect(modelSupportedFormats(kimiK3())).toEqual(["openai"]);
  });

  it("its sibling k2.6 is pinned the same way, so this is the family convention", () => {
    const k26 = models().find((m) => m.id === "kimi-k2.6");
    expect(modelSupportedFormats(k26)).toEqual(["openai"]);
  });
});

describe("a Codex image survives the Responses to Chat translation (#3392)", () => {
  const translated = () => translateRequest("openai-responses", "openai", "kimi-k3", {
    model: "kimi-k3",
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: "what is in this image?" },
        { type: "input_image", image_url: PNG, detail: "high" },
      ],
    }],
  }, false, null, "opencode-go");

  it("input_image becomes an image_url block rather than staying Responses-shaped", () => {
    const parts = translated().messages.at(-1).content;
    const img = parts.find((p) => p.type === "image_url");
    expect(img).toBeTruthy();
    expect(img.image_url.url).toBe(PNG);
  });

  it("the base64 payload is not flattened into text, which is the inflation", () => {
    const parts = translated().messages.at(-1).content;
    const text = parts.filter((p) => p.type === "text").map((p) => p.text).join("");
    expect(text).toContain("what is in this image?");
    expect(text).not.toContain("iVBORw0KGgo");
  });

  it("the requested detail is carried, not reset", () => {
    const img = translated().messages.at(-1).content.find((p) => p.type === "image_url");
    expect(img.image_url.detail).toBe("high");
  });
});
