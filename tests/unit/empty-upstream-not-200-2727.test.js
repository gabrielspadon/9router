import { describe, expect, it } from "vitest";
import { hasUsefulContent } from "open-sse/handlers/chatCore/nonStreamingHandler.js";
import { readFileSync } from "node:fs";

const src = readFileSync(
  new URL("../../open-sse/handlers/chatCore/nonStreamingHandler.js", import.meta.url), "utf8");

// An upstream that rate-limits (NVIDIA's ResourceExhausted) used to reach the
// client as HTTP 200 with `choices: null` — a success the client cannot use and
// cannot back off from (#2727). The required-field stamping that runs just
// before this guard is what supplies the `object` and `created` in that body,
// so the guard is the only thing separating "answered with nothing" from
// "answered". Its failure mode is silence, hence a direct test.
describe("an upstream that answered with nothing is not a success (#2727)", () => {
  it("rejects the exact reported body", () => {
    expect(hasUsefulContent({ object: "chat.completion", created: 1784555097, choices: null }, false, false)).toBe(false);
  });

  for (const [label, body] of [
    ["no choices key at all", {}],
    ["an empty choices array", { choices: [] }],
    ["a choice with no message", { choices: [{ index: 0 }] }],
    ["empty string content", { choices: [{ message: { role: "assistant", content: "" } }] }],
    ["whitespace-only content", { choices: [{ message: { role: "assistant", content: "   \n" } }] }],
    ["null content and no tool calls", { choices: [{ message: { role: "assistant", content: null } }] }],
    ["an empty tool_calls array", { choices: [{ message: { role: "assistant", content: "", tool_calls: [] } }] }],
  ]) {
    it(`rejects ${label}`, () => expect(hasUsefulContent(body, false, false)).toBe(false));
  }

  for (const [label, body] of [
    ["text content", { choices: [{ message: { role: "assistant", content: "hello" } }] }],
    ["a tool call and no text", { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "t1" }] } }] }],
    ["reasoning only, which a thinking model can legitimately return alone",
      { choices: [{ message: { role: "assistant", content: "", reasoning_content: "thought about it" } }] }],
    ["array content", { choices: [{ message: { role: "assistant", content: [{ type: "text", text: "hi" }] } }] }],
  ]) {
    it(`accepts ${label}`, () => expect(hasUsefulContent(body, false, false)).toBe(true));
  }

  it("applies to every provider, not just the one that prompted it", () => {
    // The forced-SSE path next door gates its equivalent check on antigravity;
    // this one must not, or a rate-limited NVIDIA reply is a 200 again.
    const i = src.indexOf("if (!hasUsefulContent(");
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, i + 200)).not.toMatch(/provider\s*===/);
  });

  it("the failure it produces is a gateway error, not a success", () => {
    const i = src.indexOf("if (!hasUsefulContent(");
    expect(src.slice(i, i + 600)).toContain("HTTP_STATUS.BAD_GATEWAY");
  });
});

describe("the Claude and Responses shapes keep their own emptiness rules", () => {
  it("an empty Claude content array is not useful", () => {
    expect(hasUsefulContent({ type: "message", content: [] }, true, false)).toBe(false);
  });
  it("a Claude tool_use block alone is useful", () => {
    expect(hasUsefulContent({ type: "message", content: [{ type: "tool_use" }] }, true, false)).toBe(true);
  });
  it("an empty Responses output is not useful", () => {
    expect(hasUsefulContent({ object: "response", output: [] }, false, true)).toBe(false);
  });
});
