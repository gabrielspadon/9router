import { describe, expect, it } from "vitest";
import { geminiToOpenAIResponse } from "open-sse/translator/response/gemini-to-openai.js";
import {
  openaiToAntigravityRequest,
  openaiToGeminiRequest,
} from "open-sse/translator/request/openai-to-gemini.js";
import { translateNonStreamingResponse } from "open-sse/handlers/chatCore/nonStreamingHandler.js";
import { geminiToOpenAIRequest } from "open-sse/translator/request/gemini-to-openai.js";
import { FORMATS } from "open-sse/translator/formats.js";
import {
  DEFAULT_THINKING_AG_SIGNATURE,
  DEFAULT_THINKING_GEMINI_CLI_SIGNATURE,
} from "open-sse/config/defaultThinkingSignature.js";

// Issue #3646. Gemini 3 signs each functionCall with a thoughtSignature bound to
// that call, and rejects the next turn when history replays the call under a
// different signature. The OpenAI pivot format has no field for it, so the real
// signature was dropped on the way out and a constant placeholder was stamped on
// the way back in — the same class of failure as the Claude one in #2693.

const REAL_SIG = "EqwBQ29tZS1mcm9tLXVwc3RyZWFtLXNpZ25hdHVyZQ";

const geminiChunk = (parts) => ({
  responseId: "resp-3646",
  modelVersion: "gemini-3-pro",
  candidates: [{ content: { parts } }],
});

// Pull the tool_call the response translator emitted for a signed functionCall.
function emitStreamingToolCall(signature) {
  const chunks = geminiToOpenAIResponse(
    geminiChunk([{ thoughtSignature: signature, functionCall: { name: "Read", args: { file_path: "/a" } } }]),
    {},
  );
  const withTools = chunks.find((c) => c?.choices?.[0]?.delta?.tool_calls);
  return withTools.choices[0].delta.tool_calls[0];
}

// The follow-up turn a client sends after running the tool it was handed.
const replayBody = (toolCallId) => ({
  messages: [
    { role: "user", content: "read it" },
    {
      role: "assistant",
      tool_calls: [
        { id: toolCallId, type: "function", function: { name: "Read", arguments: '{"file_path":"/a"}' } },
      ],
    },
    { role: "tool", tool_call_id: toolCallId, content: "file body" },
  ],
});

const functionCallParts = (contents) =>
  (contents || []).flatMap((c) => (c.parts || []).filter((p) => p.functionCall));

describe("Gemini thoughtSignature survives the tool-call round trip (#3646)", () => {
  it("the sanity check: the fixture signature is not one of the placeholders", () => {
    expect(REAL_SIG).not.toBe(DEFAULT_THINKING_AG_SIGNATURE);
    expect(REAL_SIG).not.toBe(DEFAULT_THINKING_GEMINI_CLI_SIGNATURE);
  });

  it("does not leak the signature into the client-visible tool call id", () => {
    const toolCall = emitStreamingToolCall(REAL_SIG);
    expect(toolCall.id).not.toContain(REAL_SIG);
    expect(toolCall.id).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it("replays the streamed call under its own signature, not the placeholder", () => {
    const toolCall = emitStreamingToolCall(REAL_SIG);
    const out = openaiToGeminiRequest("gemini-3-pro", replayBody(toolCall.id), true);
    const parts = functionCallParts(out.contents);
    expect(parts).toHaveLength(1);
    expect(parts[0].thoughtSignature).toBe(REAL_SIG);
  });

  it("carries it through the Antigravity Cloud Code envelope too", () => {
    const toolCall = emitStreamingToolCall(REAL_SIG);
    const out = openaiToAntigravityRequest("gemini-3-pro", replayBody(toolCall.id), true);
    const parts = functionCallParts(out.request.contents);
    expect(parts).toHaveLength(1);
    expect(parts[0].thoughtSignature).toBe(REAL_SIG);
  });

  it("does the same on the non-streaming path", () => {
    const body = translateNonStreamingResponse(
      { response: geminiChunk([{ thoughtSignature: REAL_SIG, functionCall: { name: "Read", args: { file_path: "/a" } } }]) },
      FORMATS.ANTIGRAVITY,
      FORMATS.OPENAI,
    );
    const toolCall = body.choices[0].message.tool_calls[0];
    expect(toolCall.id).not.toContain(REAL_SIG);
    const out = openaiToGeminiRequest("gemini-3-pro", replayBody(toolCall.id), true);
    expect(functionCallParts(out.contents)[0].thoughtSignature).toBe(REAL_SIG);
  });

  it("keeps a signature a Gemini-format client already persisted in its history", () => {
    // The inbound pivot dropped it just as the outbound one did: the client had
    // the real signature and tokenproxy replaced it with the placeholder.
    const openai = geminiToOpenAIRequest("gemini-3-pro", {
      contents: [
        { role: "user", parts: [{ text: "read it" }] },
        {
          role: "model",
          parts: [{
            thoughtSignature: REAL_SIG,
            functionCall: { id: "upstream-call-1", name: "Read", args: { file_path: "/a" } },
          }],
        },
        { role: "user", parts: [{ functionResponse: { id: "upstream-call-1", name: "Read", response: { result: "file body" } } }] },
      ],
    }, true);
    const out = openaiToGeminiRequest("gemini-3-pro", openai, true);
    expect(functionCallParts(out.contents)[0].thoughtSignature).toBe(REAL_SIG);
  });

  it("still falls back to the placeholder for a call it never signed", () => {
    const out = openaiToGeminiRequest("gemini-3-pro", replayBody("call_from_another_provider"), true);
    expect(functionCallParts(out.contents)[0].thoughtSignature).toBe(DEFAULT_THINKING_AG_SIGNATURE);
  });
});
