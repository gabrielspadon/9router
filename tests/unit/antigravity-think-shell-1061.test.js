import { describe, it, expect } from "vitest";
import "../translator/registerAll.js";
import { translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// #1061: Antigravity IDE -> tokenproxy MITM -> a Claude-format provider with
// thinking on. claude-to-openai used to emit literal "<think>" / "</think>"
// strings into delta.content to mark thinking-block boundaries, while the
// thinking TEXT went down the separate reasoning_content channel.
// openai-to-antigravity then splits those channels: reasoning_content becomes a
// { thought: true } part (which Antigravity drops when it persists the turn) and
// content becomes a visible { text } part. So the markers survived persistence
// as bare "<think></think>" shells, one pair per thinking block. Across an
// interleaved-thinking turn the assistant's visible text became
// "<think></think><think></think>...", Antigravity's server-side loop detector
// flagged it, and every forced retry re-sent a ~180k-token prompt.
//
// This locks the whole claude -> openai -> antigravity chain, not just the
// claude -> openai leg: the shells were only harmful once Antigravity had
// split the channels, so that is where the symptom has to stay dead.

// translateResponse(providerFormat, clientFormat, ...) pivots through OpenAI
// internally, so one call per event covers claude -> openai -> antigravity,
// exactly the chain a MITM Antigravity turn against a Claude provider takes.
function claudeToAntigravity(events) {
  const state = initState(FORMATS.ANTIGRAVITY);
  const out = [];
  for (const ev of events) {
    for (const frame of translateResponse(FORMATS.CLAUDE, FORMATS.ANTIGRAVITY, ev, state) || []) {
      if (frame) out.push(frame);
    }
  }
  return out;
}

/** One thinking block plus a tool call, the shape that produced E.G. 2. */
function interleavedThinking(blocks) {
  const events = [{ type: "message_start", message: { id: "msg_1", model: "claude-sonnet-5" } }];
  let index = 0;
  for (let i = 0; i < blocks; i++) {
    events.push({ type: "content_block_start", index, content_block: { type: "thinking" } });
    events.push({ type: "content_block_delta", index, delta: { type: "thinking_delta", thinking: `step ${i}` } });
    events.push({ type: "content_block_stop", index });
    index++;
  }
  events.push({ type: "content_block_start", index, content_block: { type: "text" } });
  events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: "Package restored." } });
  events.push({ type: "content_block_stop", index });
  events.push({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { input_tokens: 10, output_tokens: 5 } });
  events.push({ type: "message_stop" });
  return events;
}

/** Visible text is what Antigravity persists: parts WITHOUT thought:true. */
const visibleText = (frames) =>
  frames
    .flatMap((f) => f.response?.candidates?.[0]?.content?.parts || [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("");

const thoughtText = (frames) =>
  frames
    .flatMap((f) => f.response?.candidates?.[0]?.content?.parts || [])
    .filter((p) => p.thought === true)
    .map((p) => p.text)
    .join("");

describe("Antigravity loop-detection shells (#1061)", () => {
  it("persists no <think> shell for a single thinking block", () => {
    const frames = claudeToAntigravity(interleavedThinking(1));
    expect(visibleText(frames)).toBe("Package restored.");
    expect(visibleText(frames)).not.toMatch(/<\/?think>/);
  });

  it("persists no accumulated shells across four thinking blocks", () => {
    // Exactly the reported shape: four blocks became "<think></think>" x4.
    const frames = claudeToAntigravity(interleavedThinking(4));
    const visible = visibleText(frames);
    expect(visible).toBe("Package restored.");
    expect(visible).not.toContain("<think>");
    expect(visible).not.toContain("</think>");
  });

  it("still delivers the reasoning itself on the thought channel", () => {
    const frames = claudeToAntigravity(interleavedThinking(2));
    // The markers going away must not take the thinking text with them.
    expect(thoughtText(frames)).toBe("step 0step 1");
  });

  it("never emits a visible part that is only a marker, even with no text block", () => {
    // E.G. 2 in the report: thinking blocks and no assistant text at all.
    const frames = claudeToAntigravity([
      { type: "message_start", message: { id: "msg_2", model: "claude-sonnet-5" } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "quiet" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { input_tokens: 1, output_tokens: 1 } },
      { type: "message_stop" },
    ]);
    expect(visibleText(frames)).toBe("");
    expect(thoughtText(frames)).toBe("quiet");
  });
});
