import { describe, expect, it } from "vitest";
import { FORMATS } from "open-sse/translator/formats.js";
import { initState, translateResponse } from "open-sse/translator/index.js";
import { formatSSE } from "open-sse/utils/streamHelpers.js";

describe("SSE null-event suppression", () => {
  it("does not surface a null same-format flush chunk", () => {
    expect(translateResponse(FORMATS.OPENAI, FORMATS.OPENAI, null, initState(FORMATS.OPENAI))).toEqual([]);
  });

  it("does not format nullish payloads as SSE records", () => {
    expect(formatSSE(null, FORMATS.OPENAI)).toBe("");
    expect(formatSSE(undefined, FORMATS.OPENAI)).toBe("");
  });

  it("preserves normal same-format chunks and the done sentinel", () => {
    const chunk = { id: "chatcmpl_1", choices: [{ delta: { content: "ok" } }] };

    expect(translateResponse(FORMATS.OPENAI, FORMATS.OPENAI, chunk, initState(FORMATS.OPENAI))).toEqual([chunk]);
    expect(formatSSE(chunk, FORMATS.OPENAI)).toBe(`data: ${JSON.stringify(chunk)}\n\n`);
    expect(formatSSE({ done: true }, FORMATS.OPENAI)).toBe("data: [DONE]\n\n");
  });

  it("still emits state-derived cross-format terminal events during flush", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, {
      id: "chatcmpl_1",
      choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }],
    }, state);

    const flushed = translateResponse(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, null, state);

    expect(flushed.map(event => event.event)).toContain("response.completed");
  });
});
