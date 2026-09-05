import { describe, it, expect } from "vitest";

import { applyMemoryEnhancements } from "../../open-sse/services/memory/index.js";

// Isolation regression: the memory stage used to prune the caller's body in
// place (RTK and privacy got private copies at #3566; mem did not). An
// account-fallback retry hands the same body object back to the pipeline, and
// a second run re-trimmed another 39,822 chars of already-trimmed history.
// The stage must deep-isolate messages/input/contents before any mutation.

function richBody() {
  const messages = [{ role: "system", content: "You are a careful engineer." }];
  // More tool turns than DEFAULT_PRESSURE_KEEP_TURNS (20) so rung 1 has
  // candidates; the body stays over budget even after rung 1, which is the
  // condition under which a shared caller body used to get double-trimmed.
  for (let i = 1; i <= 30; i++) {
    messages.push({
      role: "user",
      content: [
        { type: "tool_use", id: `tu-${i}`, name: "read_file", input: { path: `f${i}.js` } },
        {
          type: "tool_result",
          tool_use_id: `tu-${i}`,
          content: `R${i} `.repeat(3000),
        },
      ],
    });
  }
  messages.push({ role: "user", content: "the current question" });
  return { messages };
}

const OPTS = { settings: {}, targetFormat: "claude", contextWindow: 900, log: null };

describe("memory stage isolation (audit finding 3)", () => {
  it("the caller's messages content is untouched after a run, even while still over budget", async () => {
    const body = richBody();
    // The object a retry would re-read is the caller's original array: the
    // stage may replace body.messages with a private copy, but the original
    // array's content must survive byte-identical.
    const originalMessages = body.messages;
    const before = JSON.stringify(originalMessages);
    const res = await applyMemoryEnhancements(body, OPTS);
    expect(res.stats.toolPruning.applied).toBe(true);
    expect(res.stats.toolPruning.savedChars).toBeGreaterThan(0);
    expect(JSON.stringify(originalMessages)).toBe(before);
    expect(body.messages).not.toBe(originalMessages); // private copy was pruned
  });

  it("a second run on the same body object cannot double-prune the caller's history", async () => {
    const body = richBody();
    const originalMessages = body.messages;
    const before = JSON.stringify(originalMessages);
    const r1 = await applyMemoryEnhancements(body, OPTS);
    expect(r1.stats.toolPruning.savedChars).toBeGreaterThan(0);
    const r2 = await applyMemoryEnhancements(body, OPTS);
    // The caller's original conversation is byte-identical after both runs:
    // nothing was consumed, so an account-fallback retry cannot re-trim
    // another slice (measured pre-fix: 39,822 chars on the second run).
    expect(JSON.stringify(originalMessages)).toBe(before);
    // The second run starts from run one's returned body (the caller kept
    // the replaced reference), so it prunes only what still overflows.
    expect(r2.stats.toolPruning.savedChars).toBeGreaterThan(0);
  });

  it("gemini contents arrays are isolated too", async () => {
    const body = {
      contents: [
        { role: "user", parts: [{ text: `U `.repeat(4000) }] },
        { role: "model", parts: [{ text: `M `.repeat(4000) }] },
        { role: "user", parts: [{ text: "live" }] },
      ],
    };
    const originalContents = body.contents;
    const before = JSON.stringify(originalContents);
    await applyMemoryEnhancements(body, {
      ...OPTS,
      targetFormat: "gemini",
    });
    expect(JSON.stringify(originalContents)).toBe(before);
  });
});
