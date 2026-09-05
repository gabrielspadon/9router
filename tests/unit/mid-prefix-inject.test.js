// Mid-prefix boundary note injection (open-sse/utils/midPrefixInject.js).
// Passthrough cases return the SAME messages reference; success returns a
// new array with only the target message replaced by a new object.

import { describe, it, expect } from "vitest";
import {
  injectBoundaryNote,
  composeBoundaryNote,
} from "../../open-sse/utils/midPrefixInject.js";

const deepFreeze = (v) => {
  if (v && typeof v === "object") {
    Object.values(v).forEach(deepFreeze);
    Object.freeze(v);
  }
  return v;
};

const USER_BLOCK_MSG = {
  role: "user",
  content: [{ type: "text", text: "kept turn" }],
};

describe("injectBoundaryNote", () => {
  it("appends a text block to block-array user content", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "a" }] },
      { role: "assistant", content: "b" },
    ];
    const { messages: out, injected, targetIndex } = injectBoundaryNote(
      messages, 0, "dropped 3 turns"
    );
    expect(injected).toBe(true);
    expect(targetIndex).toBe(0);
    expect(out[0].content).toHaveLength(2);
    expect(out[0].content[1]).toEqual({
      type: "text",
      text: "[tokenproxy context note] dropped 3 turns",
    });
    expect(out[0].content[0]).toEqual({ type: "text", text: "a" });
  });

  it("converts string content to a block array with the note appended", () => {
    const messages = [{ role: "user", content: "plain string" }];
    const { messages: out, injected } = injectBoundaryNote(messages, 0, "summary here");
    expect(injected).toBe(true);
    expect(Array.isArray(out[0].content)).toBe(true);
    expect(out[0].content).toEqual([
      { type: "text", text: "plain string" },
      { type: "text", text: "[tokenproxy context note] summary here" },
    ]);
  });

  it("walks forward to the next user message when insertIndex is an assistant", () => {
    const messages = [
      { role: "assistant", content: "x" },
      { role: "user", content: "later" },
    ];
    const { messages: out, injected, targetIndex } = injectBoundaryNote(
      messages, 0, "note"
    );
    expect(injected).toBe(true);
    expect(targetIndex).toBe(1);
    expect(out[1].content[1].text).toBe("[tokenproxy context note] note");
    expect(out[0]).toBe(messages[0]);
  });

  it("walks backward when no user message exists at or after insertIndex", () => {
    const messages = [
      { role: "user", content: "earlier" },
      { role: "assistant", content: "x" },
      { role: "assistant", content: "y" },
    ];
    const { messages: out, injected, targetIndex } = injectBoundaryNote(
      messages, 2, "note"
    );
    expect(injected).toBe(true);
    expect(targetIndex).toBe(0);
    expect(out[0].content[1].text).toBe("[tokenproxy context note] note");
    expect(out[1]).toBe(messages[1]);
    expect(out[2]).toBe(messages[2]);
  });

  it("returns the same reference when insertIndex is out of range", () => {
    const messages = [{ role: "user", content: "a" }];
    expect(injectBoundaryNote(messages, -1, "n").messages).toBe(messages);
    expect(injectBoundaryNote(messages, 1, "n").messages).toBe(messages);
    expect(injectBoundaryNote(messages, 0, "n").injected).toBe(true);
  });

  it("returns the same reference when no user message exists at all", () => {
    const messages = [
      { role: "assistant", content: "x" },
      { role: "system", content: "y" },
    ];
    const res = injectBoundaryNote(messages, 0, "n");
    expect(res.messages).toBe(messages);
    expect(res.injected).toBe(false);
  });

  it("returns the same reference for empty or whitespace-only noteText", () => {
    const messages = [{ role: "user", content: "a" }];
    expect(injectBoundaryNote(messages, 0, "").messages).toBe(messages);
    expect(injectBoundaryNote(messages, 0, "   \n ").messages).toBe(messages);
    expect(injectBoundaryNote(messages, 0, "").injected).toBe(false);
  });

  it("does not mutate a deep-frozen input and leaves it intact", () => {
    const messages = deepFreeze([
      { role: "user", content: [{ type: "text", text: "a" }] },
      { role: "assistant", content: "b" },
    ]);
    const { messages: out, injected } = injectBoundaryNote(messages, 0, "note");
    expect(injected).toBe(true);
    expect(out).not.toBe(messages);
    expect(out[0]).not.toBe(messages[0]);
    expect(out[0].content).not.toBe(messages[0].content);
    expect(messages[0].content).toHaveLength(1);
    expect(out[1]).toBe(messages[1]);
  });
});

describe("composeBoundaryNote", () => {
  it("joins entries with the header and middle dot separator", () => {
    const note = composeBoundaryNote([
      { kind: "compress", text: "turn 1-3 compressed" },
      { kind: "drop", text: "turn 4 dropped" },
    ]);
    expect(note).toBe(
      "Earlier turns were optimized: compress: turn 1-3 compressed · drop: turn 4 dropped"
    );
  });

  it("flattens whitespace and clips each entry to noteChars", () => {
    const long = "word ".repeat(60).trim();
    const note = composeBoundaryNote([{ kind: "strip", text: `a\n  b\t c ${long}` }], {
      noteChars: 20,
    });
    const entry = note.replace("Earlier turns were optimized: ", "");
    expect(entry.startsWith("strip: a b c")).toBe(true);
    expect(entry.length).toBeLessThanOrEqual("strip: ".length + 20);
    expect(note).not.toMatch(/[\n\t]/);
  });

  it("keeps only the last maxNotes entries", () => {
    const notes = Array.from({ length: 12 }, (_, i) => ({
      kind: "drop",
      text: `turn ${i + 1}`,
    }));
    const note = composeBoundaryNote(notes, { maxNotes: 5 });
    const entries = note.replace("Earlier turns were optimized: ", "").split(" · ");
    expect(entries).toHaveLength(5);
    expect(entries[0]).toBe("drop: turn 8");
    expect(entries[4]).toBe("drop: turn 12");
  });

  it("returns an empty string for empty, missing, or all-empty notes", () => {
    expect(composeBoundaryNote([])).toBe("");
    expect(composeBoundaryNote()).toBe("");
    expect(composeBoundaryNote([{ kind: "drop", text: "  " }])).toBe("");
  });
});
