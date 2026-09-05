import { describe, it, expect } from "vitest";
import { dropOldestPairs } from "open-sse/utils/pairDropper.js";

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item, seen);
  } else {
    for (const key of Object.keys(value)) deepFreeze(value[key], seen);
  }
  return Object.freeze(value);
}

function textPair(i) {
  return [
    { role: "user", content: `user message number ${i} ` + "x".repeat(20) },
    { role: "assistant", content: `assistant reply number ${i} ` + "y".repeat(30) },
  ];
}

function buildPairs(count, start = 0) {
  const messages = [];
  for (let i = 0; i < count; i++) messages.push(...textPair(start + i));
  return messages;
}

function pairSize(pair) {
  return JSON.stringify(pair[0]).length + JSON.stringify(pair[1]).length;
}

describe("dropOldestPairs", () => {
  it("returns the input reference when deficitChars is 0", () => {
    const input = buildPairs(3);
    const result = dropOldestPairs(input, { deficitChars: 0 });
    expect(result.messages).toBe(input);
    expect(result.droppedPairs).toBe(0);
    expect(result.savedChars).toBe(0);
    expect(result.notes).toEqual([]);
    expect(result.notesTruncated).toBe(false);
  });

  it("returns the input reference when deficitChars is negative", () => {
    const input = buildPairs(3);
    expect(dropOldestPairs(input, { deficitChars: -50 }).messages).toBe(input);
  });

  it("returns the input reference when deficitChars is missing", () => {
    const input = buildPairs(3);
    expect(dropOldestPairs(input, {}).messages).toBe(input);
  });

  it("pass non-array input through unchanged", () => {
    expect(dropOldestPairs(null, { deficitChars: 10 })).toBe(null);
    expect(dropOldestPairs("nope", { deficitChars: 10 })).toBe("nope");
  });

  it("returns the input reference for an empty array", () => {
    const input = [];
    const result = dropOldestPairs(input, { deficitChars: 100 });
    expect(result.messages).toBe(input);
    expect(result.droppedPairs).toBe(0);
  });

  it("drops oldest text-only pairs until the deficit is covered", () => {
    const input = buildPairs(4);
    const size0 = pairSize(textPair(0));
    const size1 = pairSize(textPair(1));
    const result = dropOldestPairs(input, { deficitChars: size0, protectFirstUser: false });
    expect(result.droppedPairs).toBe(1);
    expect(result.messages).toHaveLength(6);
    expect(result.messages[0]).toBe(input[2]);
    expect(result.messages[1]).toBe(input[3]);
    expect(result.savedChars).toBe(size0);
    expect(size1).toBeGreaterThan(1);
  });

  it("keeps dropping until the deficit is fully covered, then stops", () => {
    const input = buildPairs(5);
    const sizes = [0, 1, 2].map((i) => pairSize(textPair(i)));
    const deficit = sizes[0] + 1;
    const result = dropOldestPairs(input, { deficitChars: deficit, protectFirstUser: false });
    expect(result.droppedPairs).toBe(2);
    expect(result.savedChars).toBe(sizes[0] + sizes[1]);
    expect(result.messages).toHaveLength(6);
    expect(result.messages[0]).toBe(input[4]);
  });

  it("never drops or splits a pair containing tool_use", () => {
    const input = [
      ...textPair(0),
      ...textPair(1),
      { role: "user", content: "run the tool please" },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "toolu_1", name: "bash", input: { command: "ls" } },
          { type: "text", text: "done" },
        ],
      },
      ...textPair(2),
    ];
    const result = dropOldestPairs(input, { deficitChars: 100000, keepRecentTurns: 0, protectFirstUser: false });
    expect(result.droppedPairs).toBe(3);
    expect(result.messages).toContain(input[4]);
    expect(result.messages).toContain(input[5]);
    expect(result.messages).toEqual([input[4], input[5]]);
  });

  it("treats nested tool_result content as non-droppable", () => {
    const input = [
      {
        role: "user",
        content: [{ type: "text", text: "here is the result" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "wrapper",
            content: [{ type: "tool_result", tool_use_id: "toolu_9", content: "ok" }],
          },
        ],
      },
      ...buildPairs(4, 10),
    ];
    const result = dropOldestPairs(input, { deficitChars: 100000, keepRecentTurns: 0, protectFirstUser: false });
    expect(result.messages).toContain(input[0]);
    expect(result.messages).toContain(input[1]);
    expect(result.messages[0]).toBe(input[0]);
  });

  it("protects the recent tail of keepRecentTurns entries", () => {
    const input = buildPairs(4);
    const result = dropOldestPairs(input, { deficitChars: 100000, keepRecentTurns: 2, protectFirstUser: false });
    expect(result.droppedPairs).toBe(3);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toBe(input[6]);
    expect(result.messages[1]).toBe(input[7]);
  });

  it("protectFirstUser holds the first user message and its pair", () => {
    const input = buildPairs(4);
    const result = dropOldestPairs(input, { deficitChars: 100000, keepRecentTurns: 0 });
    expect(result.messages[0]).toBe(input[0]);
    expect(result.messages[1]).toBe(input[1]);
    expect(result.droppedPairs).toBe(3);
  });

  it("drops the first pair when protectFirstUser is false", () => {
    const input = buildPairs(3);
    const result = dropOldestPairs(input, { deficitChars: 100000, keepRecentTurns: 0, protectFirstUser: false });
    expect(result.droppedPairs).toBe(3);
    expect(result.messages).toHaveLength(0);
  });

  it("reports savedChars as the cumulative serialized chars removed", () => {
    const input = buildPairs(3);
    const expected = [0, 1, 2].reduce((acc, i) => acc + pairSize(textPair(i)), 0);
    const result = dropOldestPairs(input, { deficitChars: 100000, keepRecentTurns: 0, protectFirstUser: false });
    expect(result.droppedPairs).toBe(3);
    expect(result.savedChars).toBe(expected);
  });

  it("caps notes at 8 and sets notesTruncated", () => {
    const input = buildPairs(10);
    const result = dropOldestPairs(input, { deficitChars: 100000, keepRecentTurns: 0, protectFirstUser: false });
    expect(result.droppedPairs).toBe(10);
    expect(result.notes).toHaveLength(8);
    expect(result.notesTruncated).toBe(true);
    expect(result.notes[0].pair).toBe(0);
    expect(result.notes[7].pair).toBe(14);
    expect(result.notes[0].preview.length).toBeLessThanOrEqual(60);
    expect(result.notes[0].preview).toBe("user message number 0 xxxxxxxxxxxxxxxxxxxx");
  });

  it("does not mutate the frozen input and shares surviving entries by reference", () => {
    const input = deepFreeze(buildPairs(5));
    const result = dropOldestPairs(input, { deficitChars: pairSize(textPair(0)), keepRecentTurns: 4, protectFirstUser: false });
    expect(result.droppedPairs).toBe(1);
    expect(result.messages).not.toBe(input);
    expect(result.messages).toHaveLength(8);
    for (let i = 0; i < result.messages.length; i++) {
      expect(result.messages[i]).toBe(input[i + 2]);
    }
    expect(input).toHaveLength(10);
  });

  it("leaves a leading assistant message in place", () => {
    const lead = { role: "assistant", content: "orphan lead" };
    const input = [lead, ...buildPairs(3)];
    const result = dropOldestPairs(input, { deficitChars: 100000, keepRecentTurns: 0 });
    expect(result.messages[0]).toBe(lead);
    expect(result.messages).toHaveLength(3);
    expect(result.droppedPairs).toBe(2);
  });
});

describe("depth cap protects, never drops (audit finding 14)", () => {
  it("a tool_use nested deeper than the walk cap makes the pair undroppable", () => {
    // 26 levels of {content:[...]} wrappers around a tool_use block: deeper
    // than MAX_DEPTH (24). Over-depth must read as "contains marker" so the
    // pair is protected, not as "clean" (which would drop tool structure).
    let deep = { type: "tool_use", id: "tu-1", name: "read_file", input: {} };
    for (let i = 0; i < 26; i++) deep = { content: [deep] };
    const messages = [
      { role: "user", content: "question about padding " + "pad ".repeat(60) },
      { role: "assistant", content: [deep] },
      { role: "user", content: "recent one" },
      { role: "assistant", content: "recent two" },
    ];
    // The tail pair is protected by keepRecentTurns, so the ONLY candidate is
    // the deep pair: over-depth must read as "contains marker" and protect it.
    const res = dropOldestPairs(messages, {
      deficitChars: 100,
      keepRecentTurns: 2,
      protectFirstUser: false,
    });
    expect(res.droppedPairs).toBe(0);
    expect(res.messages).toBe(messages);
  });
});
