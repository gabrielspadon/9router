import { describe, expect, it } from "vitest";
import { CAVEMAN_PROMPTS, CAVEMAN_LEVELS } from "open-sse/rtk/cavemanPrompts.js";

// The report is that tool-using models "can't use task tools like write", with
// a log showing the request SUCCEEDING with 19 tools passed and caveman at
// ultra. Nothing errored — the model simply did not call anything. The prompt
// asks for maximum compression and forbids narrating tool use, which together
// read as a reason to answer directly instead of acting (#1811).
describe("the terseness prompt never suppresses tool calls (#1811)", () => {
  const levels = Object.values(CAVEMAN_LEVELS);

  it("every level carries the carve-out", () => {
    // It lives in the shared boundaries, so a new level cannot be added without
    // it by accident.
    for (const level of levels) {
      expect(CAVEMAN_PROMPTS[level]).toContain("Tool and function calls are unaffected");
    }
  });

  it("it says calls happen, not merely that they stay short", () => {
    for (const level of levels) {
      expect(CAVEMAN_PROMPTS[level]).toContain("call every tool you would normally call");
      expect(CAVEMAN_PROMPTS[level]).toContain("whether a tool is used");
    }
  });

  it("arguments are exempted from compression too", () => {
    // A compressed argument is as broken as a skipped call: a truncated path or
    // a one-word patch body fails at the tool, not at the model.
    for (const level of levels) {
      expect(CAVEMAN_PROMPTS[level]).toContain("complete and unabbreviated arguments");
      expect(CAVEMAN_PROMPTS[level]).toContain("never to structured output");
    }
  });

  it("the instruction that motivated this is still present", () => {
    // The no-narration rule is not removed — narrating a tool call is genuine
    // filler. Only the reading that it means "do not call" is closed off.
    for (const level of levels) {
      expect(CAVEMAN_PROMPTS[level]).toContain("No narrating tool calls");
    }
  });

  it("the pre-existing exact-preservation boundaries survive", () => {
    for (const level of levels) {
      expect(CAVEMAN_PROMPTS[level]).toContain("Code blocks, file paths, commands, errors, URLs: keep exact");
    }
  });

  it("ultra is still the most compressed level", () => {
    // The carve-out must not have flattened the levels into each other.
    expect(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.ULTRA]).toContain("Maximum compression");
    expect(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.LITE]).toContain("Keep grammar and full sentences");
    expect(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.ULTRA]).not.toBe(CAVEMAN_PROMPTS[CAVEMAN_LEVELS.LITE]);
  });
});
