import { describe, expect, it } from "vitest";
import { handleFusionChat } from "../../open-sse/services/combo.js";

const log = { info() {}, warn() {}, error() {} };

function harness() {
  const seen = [];
  const handleSingleModel = async (body, model) => {
    seen.push({ model, body });
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { seen, handleSingleModel };
}

const turnsOf = (b) => b.messages ?? b.input ?? b.contents ?? [];

async function lastPanelTurn(body) {
  const { seen, handleSingleModel } = harness();
  await handleFusionChat({ body, models: ["a/one", "b/two"], handleSingleModel, log, comboName: "c" });
  return turnsOf(seen[0].body).at(-1);
}

// A panel body is synthesized, so it must never end on a turn the upstream
// rejects. Gemini answers "Requests ending with a model turn are not supported";
// several OpenAI-compatible upstreams answer "The last message must have
// role=user", which a trailing system turn violates too.
describe("a fusion panel body never ends on a non-user turn (#3425)", () => {
  it("closes a trailing assistant turn on openai messages", async () => {
    const last = await lastPanelTurn({ messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "partial" }] });
    expect(last.role).toBe("user");
  });

  it("closes a trailing assistant turn on responses input", async () => {
    const last = await lastPanelTurn({ input: [{ role: "user", content: "hi" }, { role: "assistant", content: "partial" }] });
    expect(last.role).toBe("user");
  });

  it("closes a trailing model turn on gemini contents", async () => {
    const last = await lastPanelTurn({
      contents: [{ role: "user", parts: [{ text: "hi" }] }, { role: "model", parts: [{ text: "partial" }] }],
    });
    expect(last.role).toBe("user");
    // Appended in the shape of the array it joins, or Gemini rejects the turn itself.
    expect(Array.isArray(last.parts)).toBe(true);
    expect(last.parts[0].text).toBeTruthy();
    expect(last.content).toBeUndefined();
  });

  it("closes a trailing system turn", async () => {
    const last = await lastPanelTurn({ messages: [{ role: "user", content: "hi" }, { role: "system", content: "note" }] });
    expect(last.role).toBe("user");
  });

  it("leaves a body that already ends on a user turn alone", async () => {
    const { seen, handleSingleModel } = harness();
    const body = { messages: [{ role: "assistant", content: "earlier" }, { role: "user", content: "ask" }] };
    await handleFusionChat({ body, models: ["a/one", "b/two"], handleSingleModel, log, comboName: "c" });
    const turns = turnsOf(seen[0].body);
    expect(turns).toHaveLength(2);
    expect(turns.at(-1).content).toBe("ask");
  });
});
