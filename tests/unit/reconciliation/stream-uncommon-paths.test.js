// The uncommon SSE paths, around the sentinel the translate flush now emits.
//
// The soak covered NOMINAL streams (terminal_accuracy 253/253). These are the
// paths it did not reach: an empty completion, a client that hangs up mid-stream,
// an upstream that errors partway through, and a stream that already carried its
// own sentinel. Each one either has to terminate the client correctly or has to
// leave it alone -- and "emit [DONE] on the flush" is exactly the kind of change
// that gets one of them wrong.
import { describe, expect, it, vi } from "vitest";

import { FORMATS } from "open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "open-sse/utils/stream.js";

const encoder = new TextEncoder();
const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
const doneFrames = (sse) => sse.split("\n").filter((l) => l.trim() === "data: [DONE]").length;

function pipe(chunks, { targetFormat = FORMATS.CLAUDE, sourceFormat = FORMATS.OPENAI, fail = null } = {}) {
  let i = 0;
  const src = new ReadableStream({
    // pull(), not start(): the chunks have to reach the transform before the
    // error does, or the test proves nothing about a MID-stream failure.
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
        return;
      }
      if (fail) controller.error(fail);
      else controller.close();
    },
  });
  return src.pipeThrough(
    createSSETransformStreamWithLogger(targetFormat, sourceFormat, "cc", null, null, "claude-fable-5")
  );
}

async function readAll(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    // an errored upstream surfaces here; keep what the client already saw
  }
  return text + decoder.decode();
}

const START = ev("message_start", {
  type: "message_start",
  message: { id: "msg_01", role: "assistant", model: "claude-fable-5", usage: { input_tokens: 9, output_tokens: 0 } },
});
const DELTA = ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } });
const STOP = [
  ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } }),
  ev("message_stop", { type: "message_stop" }),
].join("");

describe("G-SSE uncommon paths", () => {
  it("terminates an EMPTY completion, so a client does not hang on a zero-content reply", async () => {
    // No content_block_delta at all. The client still has to be released.
    const out = await readAll(pipe([START, STOP]));
    expect(doneFrames(out)).toBe(1);
    expect(out.endsWith("data: [DONE]\n\n")).toBe(true);
  });

  it("terminates a stream whose upstream closed WITHOUT a terminal event", async () => {
    // Truncated mid-message: no message_delta, no message_stop.
    const out = await readAll(pipe([START, DELTA]));
    expect(doneFrames(out)).toBe(1);
  });

  it("does not append a sentinel after the upstream ERRORS mid-stream", async () => {
    // flush() never runs on an errored readable, so the client sees the partial
    // body and a broken connection -- which is the honest signal. A [DONE] here
    // would tell the client the reply completed normally.
    const out = await readAll(pipe([START, DELTA], { fail: new Error("upstream exploded") }));
    expect(doneFrames(out)).toBe(0);
    expect(out).toContain("chat.completion.chunk");
  });

  it("emits exactly one sentinel on a very long stream", async () => {
    const many = [START, ...Array.from({ length: 500 }, () => DELTA), STOP];
    const out = await readAll(pipe(many));
    expect(doneFrames(out)).toBe(1);
    expect(out.endsWith("data: [DONE]\n\n")).toBe(true);
  });

  it("records usage and emits nothing further when the CLIENT hangs up", async () => {
    // cancel() is the disconnect path. It must not enqueue onto a controller the
    // consumer has already released, and it must still report what was generated.
    const onComplete = vi.fn();
    const src = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(START));
        controller.enqueue(encoder.encode(DELTA));
        // deliberately never closed: the client leaves first
      },
    });
    const out = src.pipeThrough(
      createSSETransformStreamWithLogger(
        FORMATS.CLAUDE, FORMATS.OPENAI, "cc", null, null, "claude-fable-5",
        null, null, onComplete
      )
    );
    const reader = out.getReader();
    await reader.read();
    await expect(reader.cancel()).resolves.toBeUndefined();
    // Exactly once: a disconnect must not also run the flush and report twice.
    expect(onComplete).toHaveBeenCalledTimes(1);
    // finishStream(usage, { aborted }) -> onStreamComplete(content, usage, ttftAt, { aborted })
    const [content, , , meta] = onComplete.mock.calls[0];
    expect(meta?.aborted).toBe(true);
    expect(typeof content?.content).toBe("string");
  });

  it("does not double-terminate when the upstream sent its own sentinel", async () => {
    const out = await readAll(
      pipe([`data: {"choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\n`, "data: [DONE]\n\n"], {
        targetFormat: FORMATS.OPENAI,
        sourceFormat: FORMATS.OPENAI,
      })
    );
    expect(doneFrames(out)).toBe(1);
  });
});
