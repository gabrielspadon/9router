import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../open-sse/rtk/headroom.js", import.meta.url), "utf8");
const fn = src.slice(src.indexOf("function hasUnsafeResponsesInputForCompression"));
const body = fn.slice(0, fn.indexOf("\n}\n"));

// The guard skips compression for any non-message Responses item. That is blunt
// on purpose: compression runs on the Chat-style projection, so a Responses body
// must round-trip, and that round-trip is not lossless. An allowlist was tried
// in #3571 and failed a long agentic workload with "Missing required parameter:
// 'input[66].summary'"; the reporter retracted it on that evidence.
describe("the Responses compression guard stays conservative (#3571)", () => {
  it("still treats every non-message item as unsafe", () => {
    expect(body).toContain('item.type !== "message"');
  });

  it("carries no unreachable second branch", () => {
    // The old function_call_output error check sat below the type check that
    // already returned for it, so it described a nuance that never operated.
    expect(body).not.toContain("function_call_output");
    expect(body).not.toContain("is_error");
  });

  it("records why widening it is wrong, not just that it is blunt", () => {
    const doc = src.slice(src.indexOf("Should this Responses request skip compression"), src.indexOf("function hasUnsafeResponsesInputForCompression"));
    expect(doc).toContain("input[66].summary");
    expect(doc).toContain("retracted");
    expect(doc).toMatch(/not lossless|NOT lossless/);
  });

  it("still ignores a body with no input array", () => {
    expect(body).toContain("if (!Array.isArray(body?.input)) return false");
  });

  it("reproduces the predicate's contract", () => {
    const unsafe = (b) => {
      if (!Array.isArray(b?.input)) return false;
      return b.input.some((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return false;
        return typeof item.type === "string" && item.type !== "message";
      });
    };
    expect(unsafe({ input: [{ type: "message", role: "user" }] })).toBe(false);
    expect(unsafe({ input: [{ type: "reasoning", summary: [] }] })).toBe(true);
    expect(unsafe({ input: [{ type: "function_call_output", output: "ok" }] })).toBe(true);
    expect(unsafe({ messages: [] })).toBe(false);
    expect(unsafe({ input: [null, "x", []] })).toBe(false);
  });
});
