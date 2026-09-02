import { describe, expect, it } from "vitest";
import { handleFusionChat } from "../../open-sse/services/combo.js";

const log = { info() {}, warn() {}, error() {} };

// Capture the body each panel model is called with, and answer enough for the
// fusion to complete without a real upstream.
function captureHarness() {
  const seen = [];
  const handleSingleModel = async (body, model) => {
    seen.push({ model, body });
    return new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: `answer from ${model}` } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { seen, handleSingleModel };
}

const IMAGE = { type: "image_url", image_url: { url: "data:image/png;base64,IMGDATA" } };

function blocksOf(content) {
  return Array.isArray(content) ? content : [];
}

describe("fusion panel bodies keep image blocks (#3378)", () => {
  it("carries an image that shares a message with a tool_result", async () => {
    const { seen, handleSingleModel } = captureHarness();
    await handleFusionChat({
      body: {
        model: "combo",
        messages: [
          { role: "user", content: [{ type: "text", text: "look at this" }] },
          { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "screenshot" }] },
          {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "t1", content: "captured" },
              IMAGE,
            ],
          },
        ],
      },
      models: ["a/one", "b/two"],
      handleSingleModel,
      log,
      comboName: "c",
    });

    expect(seen.length).toBeGreaterThanOrEqual(2);
    const panelMessages = seen[0].body.messages;
    const carried = panelMessages.some((m) =>
      blocksOf(m.content).some((b) => b?.type === "image_url"));
    expect(carried, "the image was dropped from the panel body").toBe(true);
  });

  it("carries an image nested inside a tool_result's own content", async () => {
    const { seen, handleSingleModel } = captureHarness();
    await handleFusionChat({
      body: {
        messages: [
          { role: "user", content: [{ type: "text", text: "go" }] },
          { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "browser" }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "ok" }, IMAGE] }] },
        ],
      },
      models: ["a/one", "b/two"],
      handleSingleModel, log, comboName: "c",
    });
    const carried = seen[0].body.messages.some((m) =>
      blocksOf(m.content).some((b) => b?.type === "image_url"));
    expect(carried, "the nested tool_result image was dropped").toBe(true);
  });

  it("carries an image on an OpenAI-format tool-role message", async () => {
    const { seen, handleSingleModel } = captureHarness();
    await handleFusionChat({
      body: {
        messages: [
          { role: "user", content: "go" },
          { role: "tool", tool_call_id: "t1", content: [{ type: "text", text: "done" }, IMAGE] },
        ],
      },
      models: ["a/one", "b/two"],
      handleSingleModel, log, comboName: "c",
    });
    const carried = seen[0].body.messages.some((m) =>
      blocksOf(m.content).some((b) => b?.type === "image_url"));
    expect(carried, "the tool-role image was dropped").toBe(true);
  });

  it("leaves a pure-text tool turn as a plain string", async () => {
    const { seen, handleSingleModel } = captureHarness();
    await handleFusionChat({
      body: {
        messages: [
          { role: "user", content: "go" },
          { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "grep" }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "3 hits" }] },
        ],
      },
      models: ["a/one", "b/two"],
      handleSingleModel, log, comboName: "c",
    });
    const flattened = seen[0].body.messages.find((m) =>
      typeof m.content === "string" && m.content.includes("[Tool result:"));
    expect(flattened, "the pure-text path must stay a plain string").toBeTruthy();
  });
});
