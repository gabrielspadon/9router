import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import {
  createSseTerminalObserver,
  MAX_SSE_TERMINAL_DATA_LINES,
  MAX_SSE_TERMINAL_RECORD_BYTES,
} from "../../open-sse/utils/streamTerminal.js";

const encoder = new TextEncoder();

function observeInChunks(observer, text, cuts = []) {
  const bytes = encoder.encode(text);
  let offset = 0;
  for (const cut of [...cuts, bytes.length]) {
    const end = Math.min(cut, bytes.length);
    if (end > offset) observer.observe(bytes.slice(offset, end));
    offset = end;
  }
}

describe("bounded typed SSE terminal observer", () => {
  it("recognizes complete OpenAI, Claude, and Responses terminal records across byte boundaries", () => {
    const openai = createSseTerminalObserver(FORMATS.OPENAI);
    observeInChunks(
      openai,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\r\n\r\n`,
      [7, 29],
    );
    expect(openai.sawTerminal()).toBe(true);

    const claude = createSseTerminalObserver(FORMATS.CLAUDE);
    const claudeTerminal = `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop", note: "🌊" })}\n\n`;
    const emoji = encoder.encode(claudeTerminal.slice(0, claudeTerminal.indexOf("🌊"))).length;
    observeInChunks(claude, claudeTerminal, [emoji + 1, emoji + 2]);
    expect(claude.sawTerminal()).toBe(true);

    const responses = createSseTerminalObserver(FORMATS.OPENAI_RESPONSES);
    observeInChunks(
      responses,
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}\n\n`,
      [15, 44],
    );
    expect(responses.sawTerminal()).toBe(true);
  });

  it("does not treat terminal-looking ordinary content as a typed terminal", () => {
    const openai = createSseTerminalObserver(FORMATS.OPENAI);
    observeInChunks(openai, `data: ${JSON.stringify({ choices: [{ delta: { content: "[DONE]" }, finish_reason: null }] })}\n\n`);
    expect(openai.sawTerminal()).toBe(false);

    const claude = createSseTerminalObserver(FORMATS.CLAUDE);
    observeInChunks(claude, `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { text: "message_stop" } })}\n\n`);
    expect(claude.sawTerminal()).toBe(false);

    const responses = createSseTerminalObserver(FORMATS.OPENAI_RESPONSES);
    observeInChunks(responses, `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "response.completed" })}\n\n`);
    expect(responses.sawTerminal()).toBe(false);
  });

  it("requires an explicit SSE event and JSON type to agree while accepting data-only terminals", () => {
    const responsesMismatch = createSseTerminalObserver(FORMATS.OPENAI_RESPONSES);
    observeInChunks(
      responsesMismatch,
      `event: response.completed\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "partial" })}\n\n`,
    );
    expect(responsesMismatch.sawTerminal()).toBe(false);

    const responsesEmptyType = createSseTerminalObserver(FORMATS.OPENAI_RESPONSES);
    observeInChunks(
      responsesEmptyType,
      `event: response.completed\ndata: ${JSON.stringify({ type: "" })}\n\n`,
    );
    expect(responsesEmptyType.sawTerminal()).toBe(false);

    const claudeMismatch = createSseTerminalObserver(FORMATS.CLAUDE);
    observeInChunks(
      claudeMismatch,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    );
    expect(claudeMismatch.sawTerminal()).toBe(false);

    const dataOnlyResponsesTerminal = createSseTerminalObserver(FORMATS.OPENAI_RESPONSES);
    observeInChunks(
      dataOnlyResponsesTerminal,
      `data: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}\n\n`,
    );
    expect(dataOnlyResponsesTerminal.sawTerminal()).toBe(true);
  });

  it("discards records beyond either hard limit and still accepts a later typed terminal", () => {
    const byBytes = createSseTerminalObserver(FORMATS.OPENAI);
    const oversized = `data: ${"x".repeat(MAX_SSE_TERMINAL_RECORD_BYTES + 1)}\n\n`;
    observeInChunks(byBytes, oversized);
    expect(byBytes.sawTerminal()).toBe(false);
    observeInChunks(byBytes, "data: [DONE]\n\n");
    expect(byBytes.sawTerminal()).toBe(true);

    const byLines = createSseTerminalObserver(FORMATS.OPENAI);
    const tooManyDataLines = `${"data: x\n".repeat(MAX_SSE_TERMINAL_DATA_LINES + 1)}\n`;
    observeInChunks(byLines, tooManyDataLines);
    expect(byLines.sawTerminal()).toBe(false);
    observeInChunks(byLines, "data: [DONE]\n\n");
    expect(byLines.sawTerminal()).toBe(true);
  });

  it("releases partial parser state without turning a fragment into a terminal", () => {
    const observer = createSseTerminalObserver(FORMATS.OPENAI);
    observeInChunks(observer, "data: [DO");
    observer.release();
    observer.release();
    observeInChunks(observer, "NE]\n\n");
    expect(observer.sawTerminal()).toBe(false);
  });

  it("returns null for emitted formats without an exact terminal predicate", () => {
    expect(createSseTerminalObserver(FORMATS.GEMINI)).toBeNull();
    expect(createSseTerminalObserver(FORMATS.OLLAMA)).toBeNull();
  });
});
