// Stats honesty: stats.bytesBefore/bytesAfter must equal the independent
// per-block char ledger, charsSaved must equal the sum of per-hit savings,
// and appliedCount (hits.length) must equal the number of rewritten blocks.
//
// Note on units: the fields are named bytes* but the implementation counts
// JS string length (UTF-16 code units), i.e. chars. These tests recompute
// the ledger in the same char units and additionally pin the char semantics
// with multibyte content.
import { describe, it, expect } from "vitest";
import { compressMessages } from "../../open-sse/rtk/index.js";

const PAD = "x".repeat(90);

function makeGitLog() {
  return Array.from({ length: 40 }, (_, i) =>
    `commit abc123${i}def\nAuthor: Dev ${i} <dev${i}@example.com>\nDate:   Sun Jul 6 10:00:0${i % 10} 2026 +0700\n\n    subject line number ${i}\n\n${PAD}\n${PAD}\n${PAD}\n`
  ).join("\n");
}

function makeGrepOutput() {
  return Array.from({ length: 60 }, (_, i) =>
    `src/module/file${i % 3}.js:${i + 1}:const value${i} = "padding padding padding padding"`
  ).join("\n");
}

// Every text field compressMessages may target, in a fixed traversal order,
// with the error-flagged ones excluded (production skips them before the
// byte ledger, so they must not appear in stats at all).
function ledgerTexts(body) {
  const out = [];
  for (const msg of body.messages ?? []) {
    if (msg.type === "function_call_output") {
      if (msg.is_error === true || msg.isError === true || msg.status === "error") continue;
      if (typeof msg.output === "string") out.push(msg.output);
      else if (Array.isArray(msg.output)) {
        for (const p of msg.output) if (p?.type === "input_text" && typeof p.text === "string") out.push(p.text);
      }
      continue;
    }
    if (msg.role === "tool" && typeof msg.content === "string") {
      if (msg.is_error === true || msg.isError === true || msg.status === "error") continue;
      out.push(msg.content);
      continue;
    }
    if (!Array.isArray(msg.content)) continue;
    for (const b of msg.content) {
      if (b?.type !== "tool_result") continue;
      if (b.is_error === true || b.isError === true || b.status === "error") continue;
      if (typeof b.content === "string") out.push(b.content);
      else if (Array.isArray(b.content)) {
        for (const p of b.content) if (p?.type === "text" && typeof p.text === "string") out.push(p.text);
      }
    }
  }
  for (const item of body.input ?? []) {
    if (item.type !== "function_call_output") continue;
    if (item.is_error === true || item.isError === true || item.status === "error") continue;
    if (typeof item.output === "string") out.push(item.output);
    else if (Array.isArray(item.output)) {
      for (const p of item.output) if (p?.type === "input_text" && typeof p.text === "string") out.push(p.text);
    }
  }
  return out;
}

function mixedBody() {
  return {
    messages: [
      { role: "user", content: "prose that must not be counted at all" },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "r_log", content: makeGitLog() },      // rewritten (git-log)
          {
            type: "tool_result",
            tool_use_id: "r_grep",
            content: [{ type: "text", text: makeGrepOutput() }],                      // rewritten (grep)
          },
          { type: "tool_result", tool_use_id: "r_small", content: "tiny" },          // under MIN, counted not rewritten
          {
            type: "tool_result",
            tool_use_id: "r_nofilter",
            content:
              "plain prose with no detectable structure at all, just words flowing on and on. ".repeat(12), // >=500 chars, single line, no filter match
          },
          { type: "tool_result", tool_use_id: "r_err", is_error: true, content: makeGitLog() }, // skipped, not counted
        ],
      },
    ],
  };
}

describe("stats honesty", () => {
  it("bytesBefore/bytesAfter equal the independent per-block char ledger", () => {
    const body = mixedBody();
    const before = structuredClone(body);
    const stats = compressMessages(body, true);

    const beforeTexts = ledgerTexts(before);
    const afterTexts = ledgerTexts(body);
    expect(afterTexts.length).toBe(beforeTexts.length);

    const expectedBefore = beforeTexts.reduce((n, t) => n + t.length, 0);
    const expectedAfter = afterTexts.reduce((n, t) => n + t.length, 0);
    expect(stats.bytesBefore).toBe(expectedBefore);
    expect(stats.bytesAfter).toBe(expectedAfter);
  });

  it("charsSaved (bytesBefore - bytesAfter) equals the sum of per-hit savings", () => {
    const body = mixedBody();
    const stats = compressMessages(body, true);
    const hitsSaved = stats.hits.reduce((n, h) => n + h.saved, 0);
    expect(stats.bytesBefore - stats.bytesAfter).toBe(hitsSaved);
    expect(hitsSaved).toBeGreaterThan(0);
  });

  it("appliedCount (hits.length) equals the number of text blocks actually rewritten", () => {
    const body = mixedBody();
    const before = structuredClone(body);
    const stats = compressMessages(body, true);

    const beforeTexts = ledgerTexts(before);
    const afterTexts = ledgerTexts(body);
    const rewritten = beforeTexts.filter((t, i) => t !== afterTexts[i]).length;
    expect(stats.hits.length).toBe(rewritten);
    expect(rewritten).toBe(2); // git-log + grep; small/no-filter/error untouched
  });

  it("per-hit saved equals the actual before/after delta of its block", () => {
    const body = mixedBody();
    const before = structuredClone(body);
    const stats = compressMessages(body, true);
    const deltas = ledgerTexts(before)
      .map((t, i) => t.length - ledgerTexts(body)[i].length)
      .filter((d) => d > 0)
      .sort((a, b) => a - b);
    const saved = stats.hits.map((h) => h.saved).sort((a, b) => a - b);
    expect(saved).toEqual(deltas);
  });

  it("multibyte content: ledger is counted in chars (UTF-16 units), not UTF-8 bytes", () => {
    // one compressible git-log block laced with multibyte chars
    const multibyte = makeGitLog().replace(/subject line/g, "sübject lïne — 日本語");
    const body = {
      messages: [
        { role: "user", content: [{ type: "tool_result", tool_use_id: "r_mb", content: multibyte }] },
      ],
    };
    const stats = compressMessages(body, true);
    // stats track String.length (chars); Buffer.byteLength would differ
    expect(stats.bytesBefore).toBe(multibyte.length);
    expect(stats.bytesBefore).not.toBe(Buffer.byteLength(multibyte, "utf8"));
    expect(stats.bytesAfter).toBe(body.messages[0].content[0].content.length);
  });

  it("body with no targeted fields: zero ledger, zero stats", () => {
    const body = { messages: [{ role: "user", content: "hello" }] };
    const stats = compressMessages(body, true);
    expect(stats.bytesBefore).toBe(0);
    expect(stats.bytesAfter).toBe(0);
    expect(stats.hits).toEqual([]);
  });
});
