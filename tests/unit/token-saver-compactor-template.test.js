import { describe, it, expect } from "vitest";

import { compactContextWindow } from "../../open-sse/services/memory/contextCompactor.js";

// The compactor's summary block is a DETERMINISTIC extraction (no model call):
// per-message lines are classified by keyword into checklist sections and file
// paths are pulled by regex. A section with no keyword match falls back to raw
// per-message lines, so fidelity depends on the history naming things the
// regexes recognize. Synthetic histories below are written so the mechanism
// can plausibly extract what the assertions check.
describe("token-saver compactor: structured checklist summary template", () => {
  const MARKER = "[Historical Context Summary by tokenproxy Memory Optimizer]";
  const SECTIONS = ["Intent:", "Decisions:", "Files:", "Errors and fixes:", "Pending:", "Next:"];

  function makeBody({ oldTurns = 24, recentTurns = 8 } = {}) {
    const messages = [{ role: "system", content: "You are a coding assistant." }];
    for (let i = 1; i <= oldTurns; i++) {
      messages.push({ role: "user", content: `old turn ${i} ` + "a".repeat(12000) });
      messages.push({ role: "assistant", content: `old answer ${i} ` + "b".repeat(12000) });
    }
    for (let i = 1; i <= recentTurns; i++) {
      messages.push({ role: "user", content: `recent question ${i}` });
      messages.push({ role: "assistant", content: `recent answer ${i}` });
    }
    return { messages };
  }

  function compact(body) {
    return compactContextWindow(body, {
      enabled: true,
      thresholdTokens: 500,
      recentTurnsToKeep: 4,
    });
  }

  function summaryOf(body) {
    const block = body.messages.find(
      (m) => m.role === "system" && typeof m.content === "string" && m.content.includes(MARKER)
    );
    expect(block).toBeTruthy();
    return block.content;
  }

  it("summary block contains all six labeled section markers", () => {
    const body = makeBody();
    expect(compact(body).compacted).toBe(true);
    const summary = summaryOf(body);
    for (const section of SECTIONS) {
      expect(summary).toContain(`\n${section}`);
    }
  });

  it("summary marker appears exactly once", () => {
    const body = makeBody();
    compact(body);
    const summary = summaryOf(body);
    expect(summary.split(MARKER).length - 1).toBe(1);
  });

  it("recent turns are preserved verbatim after compaction", () => {
    const body = makeBody();
    const originalTail = body.messages.slice(-4).map((m) => JSON.stringify(m));
    compact(body);
    expect(body.messages.length).toBe(1 + 2 + 4); // system + summary + notice + recent
    expect(body.messages.slice(-4).map((m) => JSON.stringify(m))).toEqual(originalTail);
  });

  it("extracts file paths and error text from the compacted history", () => {
    const messages = [{ role: "system", content: "sys" }];
    for (let i = 1; i <= 4; i++) {
      messages.push({ role: "user", content: `filler request ${i} ` + "x".repeat(300) });
      messages.push({ role: "assistant", content: `filler reply ${i} ` + "y".repeat(300) });
    }
    messages.push({
      role: "user",
      content: "Fix the login flow in src/auth/login.js and lib/token.js before shipping",
    });
    messages.push({
      role: "assistant",
      content: "Error: TOKEN_EXPIRED thrown from src/auth/verify.js:42. Fixed by refreshing the token cache.",
    });
    messages.push({ role: "user", content: "pre-recent question" });
    messages.push({ role: "assistant", content: "pre-recent answer" });
    messages.push({ role: "user", content: "recent question" });
    messages.push({ role: "assistant", content: "recent answer" });

    const body = { messages };
    compact(body);
    const summary = summaryOf(body);

    expect(summary).toContain("src/auth/login.js");
    expect(summary).toContain("src/auth/verify.js");
    // the error line survives verbatim inside "Errors and fixes" (250-char cap)
    expect(summary).toContain("TOKEN_EXPIRED");
    expect(summary).toMatch(/Errors and fixes:.*TOKEN_EXPIRED/s);
  });

  it("is deterministic: same input produces identical summary text", () => {
    const a = makeBody();
    const b = makeBody();
    compact(a);
    compact(b);
    expect(summaryOf(a)).toBe(summaryOf(b));
  });
});
