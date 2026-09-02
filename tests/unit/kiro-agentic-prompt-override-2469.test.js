import { describe, it, expect, afterEach } from "vitest";
import {
  KIRO_AGENTIC_SYSTEM_PROMPT,
  getKiroAgenticSystemPrompt,
  resolveKiroModel,
} from "open-sse/config/kiroConstants.js";

const original = process.env.KIRO_AGENTIC_PROMPT;
afterEach(() => {
  if (original === undefined) delete process.env.KIRO_AGENTIC_PROMPT;
  else process.env.KIRO_AGENTIC_PROMPT = original;
});

describe("the chunked-write prompt is opt-in and tunable (#2469)", () => {
  it("is attached only to the agentic model variant", () => {
    // The off switch the report says does not exist is the same model without
    // the suffix.
    expect(resolveKiroModel("claude-sonnet-4.5-agentic").agentic).toBe(true);
    expect(resolveKiroModel("claude-sonnet-4.5").agentic).toBe(false);
  });

  it("uses the shipped text when nothing overrides it", () => {
    delete process.env.KIRO_AGENTIC_PROMPT;
    expect(getKiroAgenticSystemPrompt()).toBe(KIRO_AGENTIC_SYSTEM_PROMPT);
    expect(getKiroAgenticSystemPrompt()).toContain("350 LINES");
  });

  it("an operator can replace the rule, which is what the report wants", () => {
    process.env.KIRO_AGENTIC_PROMPT = "Write at most 1000 lines per operation.";
    expect(getKiroAgenticSystemPrompt()).toBe("Write at most 1000 lines per operation.");
  });

  it("an empty value attaches nothing at all", () => {
    process.env.KIRO_AGENTIC_PROMPT = "";
    expect(getKiroAgenticSystemPrompt()).toBe("");
    process.env.KIRO_AGENTIC_PROMPT = "   ";
    expect(getKiroAgenticSystemPrompt()).toBe("");
  });

  it("is read at use, so a change needs no restart", () => {
    process.env.KIRO_AGENTIC_PROMPT = "first";
    expect(getKiroAgenticSystemPrompt()).toBe("first");
    process.env.KIRO_AGENTIC_PROMPT = "second";
    expect(getKiroAgenticSystemPrompt()).toBe("second");
  });

  it("the shipped default is still exported for anything that documents it", () => {
    expect(KIRO_AGENTIC_SYSTEM_PROMPT).toContain("CHUNKED WRITE PROTOCOL");
  });
});
