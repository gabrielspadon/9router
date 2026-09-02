import { describe, expect, it } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";

// "developer" is a Responses-API instruction role. filterToOpenAIFormat maps it
// to "system", but only when the target format is literally FORMATS.OPENAI, so
// every chat-completions-shaped target carrying its own format value received
// the role verbatim and dropped or ignored the instruction message — the
// reported "system prompt ignored" from a Codex-CLI-shaped client.
const CHAT_TARGETS = ["openai", "kimi", "step", "zai", "qwen", "ollama"];
const body = () => ({
  model: "m",
  input: [
    { type: "message", role: "developer", content: [{ type: "input_text", text: "SYSTEM RULES" }] },
    { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
  ],
});
const rolesFor = (target) =>
  (translateRequest("openai-responses", target, "m", body(), false, null, "p")?.messages ?? []).map((m) => m.role);

describe("a developer role never reaches a chat-completions target (#1028 #1038)", () => {
  it.each(CHAT_TARGETS)("normalises developer to system for %s", (target) => {
    const roles = rolesFor(target);
    expect(roles, `${target} received a developer role`).not.toContain("developer");
    expect(roles).toContain("system");
  });

  it("keeps the instruction text, not just the role", () => {
    const out = translateRequest("openai-responses", "kimi", "m", body(), false, null, "p");
    const sys = out.messages.find((m) => m.role === "system");
    expect(JSON.stringify(sys.content)).toContain("SYSTEM RULES");
  });

  it("leaves user and assistant roles alone", () => {
    for (const target of CHAT_TARGETS) expect(rolesFor(target)).toContain("user");
  });

  it("still routes a top-level instructions string to a system turn", () => {
    const out = translateRequest("openai-responses", "kimi", "m",
      { model: "m", instructions: "TOP LEVEL", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }] },
      false, null, "p");
    const sys = out.messages.find((m) => m.role === "system");
    expect(JSON.stringify(sys.content)).toContain("TOP LEVEL");
  });
});
