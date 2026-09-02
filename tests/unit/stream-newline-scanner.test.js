import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createPassthroughStreamWithLogger,
  createSSETransformStreamWithLogger,
} from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function pump(stream, chunks, { cancel = false } = {}) {
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  let output = "";
  const drain = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();
  })();

  for (const chunk of chunks) await writer.write(chunk);
  if (cancel) {
    await reader.cancel("client left");
    await writer.abort("client left").catch(() => {});
  } else {
    await writer.close();
  }
  await drain;
  return output;
}

function passthrough(onStreamComplete = null, streamState = null) {
  return createPassthroughStreamWithLogger(
    "openai",
    null,
    "gpt-4o",
    "connection-1",
    { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
    onStreamComplete,
    null,
    streamState,
  );
}

function chatChunk(content = "hello") {
  return JSON.stringify({
    id: "chunk-123456",
    object: "chat.completion.chunk",
    created: 1,
    model: "gpt-4o",
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  });
}

describe("stream newline scanner", () => {
  it.each([
    ["LF", `data: ${chatChunk()}\n\ndata: [DONE]\n\n`],
    ["CRLF", `data: ${chatChunk()}\r\n\r\ndata: [DONE]\r\n\r\n`],
  ])("preserves %s passthrough framing byte-for-byte", async (_label, input) => {
    await expect(pump(passthrough(), [encoder.encode(input)])).resolves.toBe(input);
  });

  it("preserves delimiters split across chunks", async () => {
    const input = `data: ${chatChunk()}\n\ndata: [DONE]\n\n`;
    const cuts = [input.slice(0, 17), input.slice(17, -1), input.slice(-1)];
    await expect(pump(passthrough(), cuts.map((part) => encoder.encode(part)))).resolves.toBe(input);
  });

  it("preserves a UTF-8 code point split across byte chunks", async () => {
    const input = `data: ${chatChunk("hello 🌊")}\n\ndata: [DONE]\n\n`;
    const bytes = encoder.encode(input);
    const emojiOffset = input.indexOf("🌊");
    const byteOffset = encoder.encode(input.slice(0, emojiOffset)).length;
    const chunks = [bytes.slice(0, byteOffset + 1), bytes.slice(byteOffset + 1, byteOffset + 3), bytes.slice(byteOffset + 3)];
    await expect(pump(passthrough(), chunks)).resolves.toBe(input);
  });

  it("flushes a final unterminated data line before the sentinel", async () => {
    const line = `data: ${chatChunk()}`;
    await expect(pump(passthrough(), [encoder.encode(line)])).resolves.toBe(
      `${line}\ndata: [DONE]\n\n`,
    );
  });

  it("drops an unterminated null data frame before the sentinel", async () => {
    await expect(pump(passthrough(), [encoder.encode("data: null")])).resolves.toBe(
      "data: [DONE]\n\n",
    );
  });

  it("keeps same-format Responses event framing", async () => {
    const event = { type: "response.completed", response: { id: "resp-1", status: "completed" } };
    const input = `event: response.completed\ndata: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`;
    const stream = createSSETransformStreamWithLogger(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI_RESPONSES,
      "codex",
      null,
      null,
      "gpt-5.6-sol",
      "connection-1",
      { model: "gpt-5.6-sol", input: [] },
    );
    const output = await pump(stream, [encoder.encode(input)]);
    expect(output).toContain("event: response.completed\n");
    expect(output.match(/data: \[DONE\]/g)).toHaveLength(1);
  });

  it("keeps partial cancellation state synchronized", async () => {
    const onStreamComplete = vi.fn();
    const streamState = { content: "", thinking: "", usage: null, ttftAt: null };
    const input = `data: ${chatChunk("partial")}\n\n`;
    await pump(passthrough(onStreamComplete, streamState), [encoder.encode(input)], { cancel: true });
    expect(streamState.content).toBe("partial");
    expect(onStreamComplete).toHaveBeenCalledWith(
      expect.objectContaining({ content: "partial" }),
      expect.anything(),
      expect.anything(),
      { aborted: true },
    );
  });

  it("uses an index scanner instead of allocating a line array per chunk", () => {
    const source = readFileSync(
      new URL("../../open-sse/utils/stream.js", import.meta.url),
      "utf8",
    );
    expect(source).toContain('buffer.indexOf("\\n")');
    expect(source).not.toContain('buffer.split("\\n")');
  });
});
