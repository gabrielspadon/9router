import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));
vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", () => ({
  buildRequestDetail: vi.fn((detail, extra = {}) => ({ ...detail, ...extra })),
  extractRequestConfig: vi.fn(() => ({})),
  formatDoneLine: vi.fn(() => "done"),
  saveUsageStats: vi.fn(),
}));

import { FORMATS } from "../../open-sse/translator/formats.js";
import { geminiToOpenAIResponse } from "../../open-sse/translator/response/gemini-to-openai.js";
import { parseSSELine } from "../../open-sse/utils/streamHelpers.js";

const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

const CSI_PREFIX = "\x1b[2K\x1b[1A";
const ANSI_TEXT = "\x1b[31mvisible\x1b[0m";

function responseWithPart(part) {
  return {
    candidates: [{ content: { parts: [part] } }],
  };
}

function contentDelta(part, state) {
  const chunks = geminiToOpenAIResponse(responseWithPart(part), state);
  return chunks.find(chunk => chunk.choices[0].delta.content || chunk.choices[0].delta.reasoning_content)
    .choices[0].delta;
}

function forcedGeminiCliContext(providerResponse) {
  return {
    providerResponse,
    sourceFormat: FORMATS.OPENAI,
    targetFormat: FORMATS.GEMINI_CLI,
    provider: "gemini-cli",
    model: "gemini-2.5-pro",
    body: { model: "gc/gemini-2.5-pro", stream: false },
    stream: false,
    translatedBody: {},
    finalBody: {},
    requestStartTime: Date.now(),
    connectionId: "gc-test",
    apiKey: "test-key",
    clientRawRequest: { endpoint: "/v1/chat/completions", body: {} },
    onRequestSuccess: vi.fn(),
    customToolNames: null,
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    reqTag: "GC",
    log: { line: vi.fn() },
  };
}

describe("Gemini CLI ANSI stream sanitization", () => {
  it("parses a Gemini CLI data frame after terminal controls before data", () => {
    const payload = { candidates: [{ content: { parts: [{ text: "hello" }] } }] };

    expect(parseSSELine(`${CSI_PREFIX}data: ${JSON.stringify(payload)}`, FORMATS.GEMINI_CLI)).toEqual(payload);
  });

  it("removes terminal controls embedded in Gemini CLI JSON before parsing", () => {
    const raw = `data: {"candidates":[{"content":{"parts":[{"text":"${ANSI_TEXT}"}]}}]}`;

    expect(parseSSELine(raw, FORMATS.GEMINI_CLI)).toEqual({
      candidates: [{ content: { parts: [{ text: "visible" }] } }],
    });
  });

  it("removes all raw controls from Gemini CLI JSON before parsing", () => {
    const raw = 'data: {"candidates":[{"content":{"parts":[{"text":"a\tb\rc"}]}}]}';

    expect(parseSSELine(raw, FORMATS.GEMINI_CLI)).toEqual({
      candidates: [{ content: { parts: [{ text: "abc" }] } }],
    });
  });

  it("recognizes Gemini CLI DONE after a terminal control prefix", () => {
    expect(parseSSELine(`${CSI_PREFIX}data: [DONE]`, FORMATS.GEMINI_CLI)).toEqual({ done: true });
  });

  it("recognizes Gemini CLI DONE after single-character and C1 controls", () => {
    expect(parseSSELine("\x1b7data: [DONE]", FORMATS.GEMINI_CLI)).toEqual({ done: true });
    expect(parseSSELine("\x1bcdata: [DONE]", FORMATS.GEMINI_CLI)).toEqual({ done: true });
    expect(parseSSELine("\x9b2Kdata: [DONE]", FORMATS.GEMINI_CLI)).toEqual({ done: true });
  });

  it("removes decoded terminal controls from unsigned and signed thought text", () => {
    expect(contentDelta({ text: ANSI_TEXT }, { provider: "gemini-cli" }).content).toBe("visible");
    expect(contentDelta(
      { thought: true, thoughtSignature: "sig", text: ANSI_TEXT },
      { provider: "gemini-cli" },
    ).reasoning_content).toBe("visible");
  });

  it("keeps a Gemini CLI function call beside ANSI-only text", () => {
    const chunks = geminiToOpenAIResponse(responseWithPart({
      text: CSI_PREFIX,
      functionCall: { name: "search", args: {} },
    }), { provider: "gemini-cli" });

    expect(chunks.some(chunk => chunk.choices[0].delta.tool_calls?.[0]?.function.name === "search")).toBe(true);
  });

  it("sanitizes a forced non-stream Gemini CLI response through the shared parser", async () => {
    const frame = {
      responseId: "gc-forced",
      modelVersion: "gemini-2.5-pro",
      candidates: [{
        content: { parts: [{ text: ANSI_TEXT }] },
        finishReason: "STOP",
      }],
    };
    const providerResponse = new Response(`${CSI_PREFIX}data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`, {
      headers: { "content-type": "text/event-stream" },
    });

    const result = await handleForcedSSEToJson(forcedGeminiCliContext(providerResponse));

    expect(result.success).toBe(true);
    expect((await result.response.json()).choices[0].message.content).toBe("visible");
  });

  it("leaves generic Gemini parsing and translation unchanged", () => {
    expect(parseSSELine(`${CSI_PREFIX}data: {"ok":true}`, FORMATS.GEMINI)).toBeNull();
    expect(contentDelta({ text: ANSI_TEXT }, { provider: "gemini" }).content).toBe(ANSI_TEXT);
  });
});
