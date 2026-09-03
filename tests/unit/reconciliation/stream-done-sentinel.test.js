// The [DONE] sentinel is owned by the CLIENT protocol, not the provider.
//
// stream.js:568-582 already states the rule for the PASSTHROUGH flush: the
// sentinel is an OpenAI convention and belongs on every stream whose client
// speaks OpenAI, and on no stream whose client speaks Claude or Gemini. The
// TRANSLATE flush never implemented that rule. It emitted [DONE] only for the
// OpenAI *Responses* sub-case (keepsOpenAIResponsesFormat), so an ordinary
// /v1/chat/completions caller got no sentinel whenever the upstream format
// differed from the client format -- which is every claude-family model, the
// fleet's primary path. An OpenAI-protocol client waiting for [DONE] hangs
// until timeout and then fails over.
import { describe, expect, it } from "vitest";

import { FORMATS } from "open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "open-sse/utils/stream.js";

const encoder = new TextEncoder();

async function drain(input, targetFormat, sourceFormat, provider, model) {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });
  const reader = stream
    .pipeThrough(
      createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider, null, null, model)
    )
    .getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

// A minimal but complete Anthropic wire stream, ending at message_stop exactly
// as the real provider does.
const claudeStream = () =>
  [
    ev("message_start", {
      type: "message_start",
      message: {
        id: "msg_01",
        role: "assistant",
        model: "claude-fable-5",
        usage: { input_tokens: 12, output_tokens: 0 },
      },
    }),
    ev("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    }),
    ev("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "hi" },
    }),
    ev("content_block_stop", { type: "content_block_stop", index: 0 }),
    ev("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 5 },
    }),
    ev("message_stop", { type: "message_stop" }),
  ].join("");

const doneFrames = (sse) => sse.split("\n").filter((l) => l.trim() === "data: [DONE]").length;

describe("G-SSE - the [DONE] sentinel follows the client protocol on the translate path", () => {
  it("terminates a claude-upstream stream for an OpenAI chat-completions client", async () => {
    const out = await drain(claudeStream(), FORMATS.CLAUDE, FORMATS.OPENAI, "cc", "claude-fable-5");
    // The decisive assertion: the fleet path that measured 0 sentinels live.
    expect(doneFrames(out)).toBe(1);
    expect(out.endsWith("data: [DONE]\n\n")).toBe(true);
  });

  it("emits the sentinel exactly once, never twice", async () => {
    const out = await drain(claudeStream(), FORMATS.CLAUDE, FORMATS.OPENAI, "cc", "claude-fable-5");
    expect(doneFrames(out)).toBe(1);
  });

  it("still withholds the sentinel from a client that speaks Claude", async () => {
    // Anthropic has no [DONE] in its wire protocol; a bare data-only frame after
    // message_stop is a frame the SDK has no state for. Same rule as the
    // passthrough flush, and the fix must not regress it.
    const out = await drain(claudeStream(), FORMATS.CLAUDE, FORMATS.CLAUDE, "cc", "claude-fable-5");
    expect(doneFrames(out)).toBe(0);
  });
});
