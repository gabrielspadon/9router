import { describe, it, expect } from "vitest";
import { compressPrefixByQuery } from "../../open-sse/utils/queryAwareCompress.js";

const QUERY = "reticulated spline calibration procedure";

function turn(role, text) {
  return { role, content: [{ type: "text", text }] };
}

// Four historical turns plus two recent ones. Historical: one relevant to the
// query, one irrelevant. Recent: both irrelevant on purpose.
function conversation() {
  return [
    turn("user", "can we reticulate the spline calibration procedure before the run"),
    turn("assistant", "yes the reticulated spline calibration is staged"),
    turn("user", "lunch order for the team pizza sandwiches salad"),
    turn("assistant", "the pizza place closes at six"),
    turn("user", "what about the deploy window today"),
    turn("assistant", "deploy window is after lunch"),
  ];
}

const scoreFor = (text, termCount) => {
  const words = text.toLowerCase().match(/[a-z0-9]+/g).length;
  return 1 / (1 + Math.log2(1 + words / 8)) / termCount;
};

describe("compressPrefixByQuery", () => {
  it("fails open on a short query and returns the input reference", () => {
    const messages = conversation();
    const result = compressPrefixByQuery(messages, { query: "deploy" });
    expect(result.messages).toBe(messages);
    expect(result.compressed).toBe(0);
    expect(result.notes).toEqual([]);
  });

  it("fails open when query has fewer than 3 usable terms", () => {
    const messages = conversation();
    const result = compressPrefixByQuery(messages, { query: "deploy now ok" });
    expect(result.messages).toBe(messages);
    expect(result.compressed).toBe(0);
  });

  it("fails open on empty messages", () => {
    const messages = [];
    const result = compressPrefixByQuery(messages, { query: QUERY });
    expect(result.messages).toBe(messages);
    expect(result.compressed).toBe(0);
  });

  it("compresses irrelevant historical blocks and keeps relevant ones verbatim", () => {
    const messages = conversation();
    const result = compressPrefixByQuery(messages, { query: QUERY });
    expect(result.compressed).toBe(2);
    // Relevant historical turns untouched, by reference.
    expect(result.messages[0]).toBe(messages[0]);
    expect(result.messages[1]).toBe(messages[1]);
    // Irrelevant historical turns compressed with the placeholder.
    expect(result.messages[2].content[0].text).toBe(
      '[tokenproxy: earlier turn about "lunch order for the team pizza sandwiches salad" ' +
        'compressed, low relevance to the current query]'
    );
    expect(result.messages[3].content[0].text).toContain(
      "[tokenproxy: earlier turn about"
    );
    expect(result.notes).toEqual([
      { turn: 2, preview: "lunch order for the team pizza sandwiches salad" },
      { turn: 3, preview: "the pizza place closes at six" },
    ]);
  });

  it("never touches recent turns even when they are irrelevant", () => {
    const messages = conversation();
    const result = compressPrefixByQuery(messages, { query: QUERY });
    expect(result.messages[4]).toBe(messages[4]);
    expect(result.messages[5]).toBe(messages[5]);
    expect(result.compressed).toBe(2);
  });

  it("respects a custom keepRecentTurns boundary", () => {
    const messages = conversation();
    const result = compressPrefixByQuery(messages, { query: QUERY, keepRecentTurns: 1 });
    // Only the last turn is held back now, so recent irrelevant turns 2-4 compress.
    expect(result.compressed).toBe(3);
    expect(result.messages[0]).toBe(messages[0]);
    expect(result.messages[1]).toBe(messages[1]);
    expect(result.messages[2].content[0].text).toContain("[tokenproxy:");
    expect(result.messages[4].content[0].text).toContain("[tokenproxy:");
  });

  it("keeps a block at exactly the threshold, compresses below it", () => {
    // Exactly one of the four query terms present in the historical block.
    const termCount = 4;
    const text = "the calibration is due tonight";
    const exact = scoreFor(text, termCount);
    const messages = [
      turn("user", text),
      turn("user", "reticulated spline calibration"),
      turn("assistant", "ok"),
    ];
    const kept = compressPrefixByQuery(messages, {
      query: QUERY,
      threshold: exact,
    });
    expect(kept.messages).toBe(messages);
    expect(kept.compressed).toBe(0);
    const gone = compressPrefixByQuery(messages, {
      query: QUERY,
      threshold: exact + 1e-12,
    });
    expect(gone.compressed).toBe(1);
    expect(gone.messages[0].content[0].text).toContain("[tokenproxy: earlier turn about");
  });

  it("treats string content as one block and replaces it with the placeholder string", () => {
    const messages = [
      { role: "user", content: "lunch order for the team pizza sandwiches salad" },
      { role: "assistant", content: "reticulated spline calibration is staged" },
      { role: "user", content: "what about the deploy window today" },
    ];
    const result = compressPrefixByQuery(messages, { query: QUERY });
    expect(result.compressed).toBe(1);
    expect(result.messages[0].content).toBe(
      '[tokenproxy: earlier turn about "lunch order for the team pizza sandwiches salad" ' +
        'compressed, low relevance to the current query]'
    );
    expect(result.notes).toEqual([
      { turn: 0, preview: "lunch order for the team pizza sandwiches salad" },
    ]);
  });

  it("honors previewChars in the placeholder and notes", () => {
    const messages = conversation();
    const result = compressPrefixByQuery(messages, { query: QUERY, previewChars: 10 });
    expect(result.messages[2].content[0].text).toBe(
      '[tokenproxy: earlier turn about "lunch orde" compressed, low relevance to the current query]'
    );
    expect(result.notes[0].preview).toBe("lunch orde");
  });

  it("does not mutate a deep-frozen input and shares untouched parts by reference", () => {
    const messages = conversation();
    const deepFreeze = (value) => {
      if (value && typeof value === "object") {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
      }
    };
    deepFreeze(messages);
    const result = compressPrefixByQuery(messages, { query: QUERY });
    expect(result.messages).not.toBe(messages);
    expect(result.messages[0]).toBe(messages[0]);
    expect(result.messages[1]).toBe(messages[1]);
    expect(result.messages[2]).not.toBe(messages[2]);
    expect(result.messages[2].content[0]).not.toBe(messages[2].content[0]);
    expect(result.messages[2].content).not.toBe(messages[2].content);
    // Original intact.
    expect(messages[2].content[0].text).toBe(
      "lunch order for the team pizza sandwiches salad"
    );
  });

  it("caps notes at 8 and sets notesTruncated", () => {
    const messages = [];
    for (let i = 0; i < 12; i++) {
      messages.push(turn("user", `lunch order number ${i} pizza salad`));
    }
    messages.push(turn("user", "reticulated spline calibration"));
    messages.push(turn("user", "reticulated spline calibration again"));
    const result = compressPrefixByQuery(messages, { query: QUERY });
    expect(result.compressed).toBe(12);
    expect(result.notes).toHaveLength(8);
    expect(result.notesTruncated).toBe(true);
    expect(result.messages[11].content[0].text).toContain("[tokenproxy:");
  });

  it("returns input reference when nothing falls below the threshold", () => {
    const messages = conversation();
    const result = compressPrefixByQuery(messages, { query: QUERY, threshold: 0 });
    expect(result.messages).toBe(messages);
    expect(result.compressed).toBe(0);
    expect(result.notesTruncated).toBe(false);
  });

  it("leaves tool_result content and system messages alone", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "tool_result", content: "lunch order pizza salad" },
          { type: "text", text: "lunch order pizza salad details" },
        ],
      },
      { role: "system", content: [{ type: "text", text: "lunch order pizza" }] },
      { role: "user", content: "what about the deploy window today" },
      { role: "assistant", content: [{ type: "text", text: "deploy after lunch" }] },
    ];
    const result = compressPrefixByQuery(messages, { query: QUERY });
    // Only the role-level text block compresses; the tool_result block and the
    // system message pass through by reference.
    expect(result.compressed).toBe(1);
    expect(result.messages[0].content[0]).toBe(messages[0].content[0]);
    expect(result.messages[1]).toBe(messages[1]);
    expect(result.messages[0].content[1].text).toContain("[tokenproxy:");
  });
});
