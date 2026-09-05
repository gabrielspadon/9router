import { describe, expect, it } from "vitest";

import { stripHistoricalThinking } from "../../open-sse/utils/thinkingStrip.js";

const thinkingBlock = (text) => ({ type: "thinking", thinking: text, signature: "sig" });
const textBlock = (text) => ({ type: "text", text });

const messagesFixture = () => [
  { role: "user", content: "solve this" },
  {
    role: "assistant",
    content: [thinkingBlock("old reasoning"), textBlock("old answer")],
  },
  { role: "user", content: "now this" },
  {
    role: "assistant",
    content: [
      thinkingBlock("live reasoning"),
      { type: "tool_use", id: "call_1", name: "read_file", input: {} },
    ],
  },
  { role: "tool", tool_call_id: "call_1", content: "ok" },
];

function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

describe("stripHistoricalThinking", () => {
  it("strips historical thinking but keeps the last assistant turn's thinking", () => {
    const result = stripHistoricalThinking(messagesFixture());

    expect(result.stripped).toBe(1);
    expect(result.messages[1].content).toEqual([textBlock("old answer")]);
    expect(result.messages[3].content).toHaveLength(2);
    expect(result.messages[3].content[0]).toEqual(thinkingBlock("live reasoning"));
    expect(result.notes).toEqual([{ turn: 1, blocks: 1 }]);
  });

  it("keeps thinking when there is only one assistant turn", () => {
    const input = [
      { role: "user", content: "hi" },
      { role: "assistant", content: [thinkingBlock("only reasoning"), textBlock("answer")] },
    ];

    const result = stripHistoricalThinking(input);

    expect(result.messages).toBe(input);
    expect(result.stripped).toBe(0);
    expect(result.notes).toEqual([]);
  });

  it("strips redacted_thinking blocks", () => {
    const result = stripHistoricalThinking([
      { role: "assistant", content: [{ type: "redacted_thinking", data: "opaque" }, textBlock("a")] },
      { role: "assistant", content: [thinkingBlock("keep me")] },
    ]);

    expect(result.stripped).toBe(1);
    expect(result.messages[0].content).toEqual([textBlock("a")]);
    expect(result.messages[1].content).toEqual([thinkingBlock("keep me")]);
  });

  it("leaves string content untouched", () => {
    const input = [
      { role: "assistant", content: "plain string answer" },
      { role: "assistant", content: [thinkingBlock("recent")] },
    ];

    const result = stripHistoricalThinking(input);

    expect(result.messages[0]).toBe(input[0]);
    expect(result.messages[1]).toBe(input[1]);
    expect(result.messages).toBe(input);
    expect(result.stripped).toBe(0);
  });

  it("never touches tool_use or tool_result blocks", () => {
    const result = stripHistoricalThinking([
      {
        role: "assistant",
        content: [
          thinkingBlock("gone"),
          { type: "tool_use", id: "call_1", name: "read_file", input: {} },
        ],
      },
      { role: "assistant", content: [thinkingBlock("kept")] },
    ]);

    expect(result.messages[0].content).toEqual([
      { type: "tool_use", id: "call_1", name: "read_file", input: {} },
    ]);
    expect(result.messages[1].content).toEqual([thinkingBlock("kept")]);
  });

  it("inserts a placeholder when stripping empties the content array", () => {
    const result = stripHistoricalThinking([
      { role: "assistant", content: [thinkingBlock("only a thought")] },
      { role: "assistant", content: [thinkingBlock("kept")] },
    ]);

    expect(result.messages[0].content).toEqual([
      { type: "text", text: "[tokenproxy: prior reasoning stripped to save context]" },
    ]);
  });

  it("returns the input reference unchanged and never mutates a frozen input", () => {
    const input = deepFreeze(messagesFixture());

    expect(() => stripHistoricalThinking(input)).not.toThrow();

    const result = stripHistoricalThinking(input);
    expect(result.messages).not.toBe(input);
    expect(result.stripped).toBe(1);
    expect(input[1].content).toHaveLength(2);
    expect(result.messages[1].content).toHaveLength(1);
    expect(result.messages[2]).toBe(input[2]);
    expect(result.messages[1].content[0]).toBe(input[1].content[1]);
  });

  it("caps notes at notesMax and flags truncation", () => {
    const input = [];
    for (let i = 0; i < 12; i++) {
      input.push({
        role: "assistant",
        content: [thinkingBlock(`reasoning ${i}`), textBlock(`answer ${i}`)],
      });
    }

    const result = stripHistoricalThinking(input, { keepRecentTurns: 1, notesMax: 3 });

    expect(result.stripped).toBe(11);
    expect(result.notes).toHaveLength(3);
    expect(result.notes).toEqual([
      { turn: 0, blocks: 1 },
      { turn: 1, blocks: 1 },
      { turn: 2, blocks: 1 },
    ]);
    expect(result.notesTruncated).toBe(true);
  });

  it("passes through empty and non-array input", () => {
    for (const input of [undefined, null, "nope", {}, 7]) {
      expect(stripHistoricalThinking(input)).toEqual({ messages: input, stripped: 0, notes: [] });
    }
    expect(stripHistoricalThinking([])).toEqual({ messages: [], stripped: 0, notes: [] });
  });

  it("passes through garbage entries", () => {
    const input = [null, { role: "system" }, 42, { role: "assistant" }, { role: "assistant", content: null }];

    const result = stripHistoricalThinking(input);

    expect(result.messages).toBe(input);
    expect(result.stripped).toBe(0);
  });
});
