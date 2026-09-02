import { describe, expect, it } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

// Issue #2611. In the Responses protocol `output_index` identifies an item in
// the response's output array. Reasoning, the assistant message and each
// function call are separate items and need distinct indices. They were all
// emitted with the OpenAI *choice* index, which is 0 for a single-choice
// stream, so recordOutputItem wrote every one of them to responseOutput[0] and
// they overwrote each other. The completed event then carried one item where
// three were produced, which is why a function call went missing downstream.

async function transform(chunks) {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  const stream = new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); },
  });
  const out = stream.pipeThrough(
    createSSETransformStreamWithLogger(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, "codex", null, null, "gpt-5.5"),
  );
  const reader = out.getReader();
  const dec = new TextDecoder();
  let text = "";
  for (;;) { const { value, done } = await reader.read(); if (done) break; text += dec.decode(value, { stream: true }); }
  text += dec.decode();

  const events = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
    try { events.push(JSON.parse(line.slice(6))); } catch { /* framing line */ }
  }
  return events;
}

const REASONING_TEXT_AND_TOOL = [
  { choices: [{ index: 0, delta: { reasoning_content: "weighing it" } }] },
  { choices: [{ index: 0, delta: { content: "hello" } }] },
  { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "Bash", arguments: '{"a":1}' } }] } }] },
  { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
];

describe("Responses output_index identifies the item, not the choice (#2611)", () => {
  it("gives reasoning, message and tool call distinct output indices", async () => {
    const events = await transform(REASONING_TEXT_AND_TOOL);
    const added = events.filter((e) => e.type === "response.output_item.added");

    expect(added.length).toBeGreaterThanOrEqual(3);
    const indices = added.map((e) => e.output_index);
    expect(new Set(indices).size).toBe(added.length);
  });

  it("keeps every produced item in the completed output array", async () => {
    const events = await transform(REASONING_TEXT_AND_TOOL);
    const completed = events.find((e) => e.type === "response.completed");

    expect(completed).toBeTruthy();
    const types = (completed.response?.output || []).filter(Boolean).map((i) => i.type);
    expect(types).toContain("function_call");
    expect(types).toContain("message");
    expect(types.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps an item's own events on one index", async () => {
    const events = await transform(REASONING_TEXT_AND_TOOL);
    const byItem = new Map();
    for (const e of events) {
      if (!e.item_id || e.output_index === undefined) continue;
      if (!byItem.has(e.item_id)) byItem.set(e.item_id, new Set());
      byItem.get(e.item_id).add(e.output_index);
    }
    for (const [, indices] of byItem) expect(indices.size).toBe(1);
  });
});
