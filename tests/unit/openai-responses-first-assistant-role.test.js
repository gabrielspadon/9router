import { describe, expect, it } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { openaiResponsesToOpenAIResponse } from "../../open-sse/translator/response/openai-responses.js";
import { initState } from "../../open-sse/translator/index.js";

function translate(events) {
  const state = initState(FORMATS.OPENAI_RESPONSES);
  return events
    .map((event) => openaiResponsesToOpenAIResponse(event, state))
    .filter(Boolean);
}

describe("Responses to Chat assistant role framing", () => {
  it("adds one assistant role to the first visible text delta", () => {
    const chunks = translate([
      { type: "response.output_text.delta", delta: "Hello" },
      { type: "response.output_text.delta", delta: " world" },
    ]);

    expect(chunks.map((chunk) => chunk.choices[0].delta)).toEqual([
      { role: "assistant", content: "Hello" },
      { content: " world" },
    ]);
  });

  it("adds one assistant role to the first visible tool delta", () => {
    const chunks = translate([
      {
        type: "response.output_item.added",
        item: { type: "function_call", call_id: "call_1", name: "read_file" },
      },
      { type: "response.function_call_arguments.delta", delta: "{\"path\":\"README.md\"}" },
    ]);

    expect(chunks.map((chunk) => chunk.choices[0].delta)).toEqual([
      {
        role: "assistant",
        tool_calls: [{
          index: 0,
          id: "call_1",
          type: "function",
          function: { name: "read_file", arguments: "" },
        }],
      },
      {
        tool_calls: [{
          index: 0,
          function: { arguments: "{\"path\":\"README.md\"}" },
        }],
      },
    ]);
  });

  it("adds one assistant role to the first visible reasoning delta", () => {
    const chunks = translate([
      { type: "response.reasoning_summary_text.delta", delta: "Need inspect files." },
      { type: "response.reasoning_summary_text.delta", delta: " Then test." },
    ]);

    expect(chunks.map((chunk) => chunk.choices[0].delta)).toEqual([
      { role: "assistant", reasoning_content: "Need inspect files." },
      { reasoning_content: " Then test." },
    ]);
  });
});
