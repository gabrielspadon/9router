// Upstream dff648496, PARTIAL adoption — only the case-preserving
// opencode -> antigravity system-prompt rewrite. Antigravity flags a request
// whose system prompt identifies a competing client and answers 429 Quota
// Exhausted. Applied in the executor, so only Antigravity requests are
// rewritten: the shared openai-to-gemini translator also serves gemini,
// gemini-cli, vertex and zed, which must not be touched.
//
// The upstream loop refactor is deliberately NOT taken — the fork's block also
// calls sanitizeAntigravitySystemPrompt (the Hermes fix), which that refactor
// drops. The last two cases pin that the existing behaviour survives.

import { describe, expect, it } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

const CREDENTIALS = { projectId: "test-proj", connectionId: "test-conn" };

const systemText = (text) =>
  new AntigravityExecutor().transformRequest(
    "gemini-3.7-flash-high",
    {
      request: {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        systemInstruction: { parts: [{ text }] },
      },
    },
    false,
    CREDENTIALS
  ).request.systemInstruction.parts[0].text;

describe("Antigravity system prompt: opencode branding rewrite (dff648496)", () => {
  it("rewrites lowercase opencode to antigravity", () => {
    expect(systemText("You are opencode, a coding agent.")).toBe("You are antigravity, a coding agent.");
  });

  it("preserves TitleCase: OpenCode -> Antigravity", () => {
    expect(systemText("You are OpenCode, a coding agent.")).toBe("You are Antigravity, a coding agent.");
  });

  it("preserves UPPERCASE: OPENCODE -> ANTIGRAVITY", () => {
    expect(systemText("BRAND: OPENCODE")).toBe("BRAND: ANTIGRAVITY");
  });

  it("rewrites every occurrence in one prompt, each keeping its own casing", () => {
    expect(systemText("opencode / OpenCode / OPENCODE")).toBe("antigravity / Antigravity / ANTIGRAVITY");
  });

  it("leaves a prompt without the brand untouched", () => {
    expect(systemText("You are a helpful assistant.")).toBe("You are a helpful assistant.");
  });

  it("still strips the Zed Claude-agent prompt alongside the rewrite", () => {
    const out = systemText("You are a Claude agent, built on Anthropic's Claude Agent SDK. Ask OpenCode.");
    expect(out).toBe(" Ask Antigravity.");
  });

  it("still applies the Hermes sanitizer alongside the rewrite", () => {
    const out = systemText("You are Hermes Agent, an intelligent AI assistant created by Nous Research. Not opencode.");
    expect(out).toBe(
      "You are Hermes Agent. You are an intelligent AI assistant created by Nous Research. Not antigravity."
    );
  });
});
