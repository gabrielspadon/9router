import { describe, it, expect } from "vitest";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { resolveUpstreamRoute } from "../../open-sse/handlers/chatCore/upstreamRoute.js";

// #2047 — an OpenAI client asking minimax-cn/MiniMax-M3 with stream:true got
// nothing but `data: [DONE]`, while stream:false answered normally.
//
// The differential was never in the response translator. MiniMax-M3 pins
// `targetFormat: "claude"` at the model level while the transports array picks
// its endpoint from the CLIENT's format, so an OpenAI client was served
// /v1/chat/completions — OpenAI frames on the wire — while the stream
// transform had been told to read them as Claude. Every frame then failed to
// translate and the stream emitted its terminator and nothing else.
//
// Two halves are locked here: the route no longer lets the wire format and the
// declared target format disagree, and the transform carries a real MiniMax
// Claude stream through to an OpenAI client.

const encoder = new TextEncoder();

async function pump(frames, targetFormat, sourceFormat = "openai") {
  const stream = createSSETransformStreamWithLogger(
    targetFormat,
    sourceFormat,
    "minimax-cn",
    null,
    null,
    "MiniMax-M3",
    "conn-1",
    { model: "minimax-cn/MiniMax-M3", messages: [{ role: "user", content: "ping" }] },
  );
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  let out = "";
  const drain = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out += new TextDecoder().decode(value);
    }
  })();
  for (const frame of frames) await writer.write(encoder.encode(frame));
  await writer.close();
  await drain;
  return out;
}

// MiniMax's Anthropic-compatible endpoint, exactly as it frames a short reply.
const CLAUDE_WIRE = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"MiniMax-M3","content":[],"stop_reason":null,"usage":{"input_tokens":10,"output_tokens":1}}}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"pong"}}\n\n',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
];

const OPENAI_WIRE = [
  'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"MiniMax-M3","choices":[{"index":0,"delta":{"content":"pong"},"finish_reason":null}]}\n\n',
  'data: {"id":"c1","object":"chat.completion.chunk","created":1,"model":"MiniMax-M3","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
  "data: [DONE]\n\n",
];

describe("MiniMax-M3 streaming to an OpenAI client (#2047)", () => {
  for (const alias of ["minimax", "minimax-cn"]) {
    it(`${alias}/MiniMax-M3 sends an OpenAI client to the endpoint its body is written for`, () => {
      const route = resolveUpstreamRoute({
        provider: alias,
        alias,
        model: "MiniMax-M3",
        sourceFormat: "openai",
        credentials: {},
      });
      // Both must be claude. targetFormat alone was the bug: the transport
      // stayed on the sourceFormat match and served OpenAI frames.
      expect(route.targetFormat).toBe("claude");
      expect(route.transport?.format).toBe("claude");
      expect(route.transport?.baseUrl).toContain("/anthropic/v1/messages");
    });
  }

  it("delivers the answer, not a bare terminator", async () => {
    const out = await pump(CLAUDE_WIRE, "claude");
    expect(out).toContain('"content":"pong"');
    expect(out).toContain('"finish_reason":"stop"');
    expect(out.split("\n\n").filter((f) => f.startsWith("data: ")).length).toBeGreaterThan(1);
  });

  it("survives an upstream that frames with CRLF", async () => {
    const out = await pump(CLAUDE_WIRE.map((f) => f.replace(/\n/g, "\r\n")), "claude");
    expect(out).toContain('"content":"pong"');
  });

  it("drops everything when the wire format and the declared target disagree", async () => {
    // The reported symptom, reproduced as the negative control: OpenAI frames
    // read as Claude translate to nothing at all.
    expect(await pump(OPENAI_WIRE, "claude")).toBe("");
    expect(await pump(OPENAI_WIRE, "openai")).toContain('"content":"pong"');
  });
});
