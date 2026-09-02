import { describe, it, expect } from "vitest";
import { claudeToKiroRequest } from "../../open-sse/translator/request/claude-to-kiro.js";
import { openaiToKiroRequest } from "../../open-sse/translator/request/openai-to-kiro.js";

// Issue #2989 and its duplicates (#3459 #3109 #3091 #2939 #2901 #2890 #2882
// #2874 #2865 #2815 #2716 #2692). generateAssistantResponse has no top-level
// systemPrompt in its schema and answers any request carrying it with
// 400 {"message":"Improperly formed request.","reason":"REQUEST_BODY_INVALID"},
// whatever the value is. #2716 is the case that makes this easy to misread:
// the reporter sent no system prompt at all, but a thinking-intensity model
// populated the same field, so the request still 400'd.
//
// The text is not lost. contentPrefix prefixes it onto the session-start user
// message, which is where the model reads it from.

const start = (out) => out.conversationState.currentMessage.userInputMessage.content;

describe("kiro payload carries no top-level systemPrompt (#2989)", () => {
  const cases = [
    ["claude route, client system prompt", () =>
      claudeToKiroRequest("claude-sonnet-4.5", {
        system: "you are terse",
        messages: [{ role: "user", content: "hi" }],
      }, true, null), "you are terse"],

    ["claude route, no client system prompt", () =>
      claudeToKiroRequest("claude-sonnet-4.5", {
        messages: [{ role: "user", content: "hi" }],
      }, true, null), null],

    ["claude route, thinking intensity with no client system prompt (#2716)", () =>
      claudeToKiroRequest("claude-sonnet-4.5-thinking", {
        messages: [{ role: "user", content: "hi" }],
      }, true, null), "<thinking_mode>"],

    ["openai route, client system prompt", () =>
      openaiToKiroRequest("claude-sonnet-4.5", {
        messages: [{ role: "system", content: "you are terse" }, { role: "user", content: "hi" }],
      }, true, null), "you are terse"],

    ["openai route, no client system prompt", () =>
      openaiToKiroRequest("claude-sonnet-4.5", {
        messages: [{ role: "user", content: "hi" }],
      }, true, null), null],
  ];

  for (const [name, build, expectedInUserMessage] of cases) {
    it(`omits the field: ${name}`, () => {
      const out = build();
      expect(out).toBeTruthy();
      expect(out).not.toHaveProperty("systemPrompt");
      expect(Object.keys(out)).not.toContain("systemPrompt");
    });

    if (expectedInUserMessage) {
      it(`still delivers the text on the user message: ${name}`, () => {
        expect(start(build())).toContain(expectedInUserMessage);
      });
    }
  }

  it("never regains the field once tools and images are present", () => {
    const out = claudeToKiroRequest("claude-sonnet-4.5", {
      system: "you are terse",
      tools: [{ name: "lookup", input_schema: { type: "object", properties: {} } }],
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    }, true, null);

    expect(out).not.toHaveProperty("systemPrompt");
    expect(start(out)).toContain("you are terse");
  });
});
