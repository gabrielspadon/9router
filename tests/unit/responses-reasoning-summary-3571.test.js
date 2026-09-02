import { describe, expect, it } from "vitest";
import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";

// A Responses `reasoning` item must carry `summary`. Codex emits reasoning turns
// that hold only an encrypted_content continuity blob and an empty summary, and
// the round-trip through chat messages rebuilt them WITHOUT the field, which the
// API rejects with "Missing required parameter: 'input[66].summary'" — the
// failure that made #3571's reporter retract their Headroom allowlist proposal.
const reasoningItems = (body) => body.input.filter((item) => item.type === "reasoning");

describe("rebuilt reasoning items always carry summary (#3571)", () => {
  it("emits summary: [] for a reasoning turn that only has encrypted_content", () => {
    const body = {
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: "ok", encrypted_content: "gAAAAABn_opaque" },
      ],
    };
    const out = openaiToOpenAIResponsesRequest("gpt-5.6-luna", body, true);
    const items = reasoningItems(out);
    expect(items).toHaveLength(1);
    expect(items[0].encrypted_content).toBe("gAAAAABn_opaque");
    expect(Array.isArray(items[0].summary)).toBe(true);
    expect(items[0].summary).toEqual([]);
  });

  it("still carries the text when the turn had a reasoning summary", () => {
    const body = {
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: "ok", reasoning_content: "thought about it" },
      ],
    };
    const items = reasoningItems(openaiToOpenAIResponsesRequest("gpt-5.6-luna", body, true));
    expect(items).toHaveLength(1);
    expect(items[0].summary).toEqual([{ type: "summary_text", text: "thought about it" }]);
  });

  it("leaves every rebuilt reasoning item summary-bearing across a full agentic turn", () => {
    const body = {
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: null, encrypted_content: "blob-1", tool_calls: [
          { id: "call_1", type: "function", function: { name: "Bash", arguments: "{\"command\":\"ls\"}" } },
        ] },
        { role: "tool", tool_call_id: "call_1", content: "a.txt" },
        { role: "assistant", content: "done", encrypted_content: "blob-2" },
      ],
    };
    const out = openaiToOpenAIResponsesRequest("gpt-5.6-luna", body, true);
    const items = reasoningItems(out);
    expect(items).toHaveLength(2);
    for (const item of items) expect(Array.isArray(item.summary)).toBe(true);
    // No item in the rebuilt input may be missing the field the API requires.
    for (const [i, item] of out.input.entries()) {
      if (item.type === "reasoning") expect(item.summary, `input[${i}].summary`).toBeDefined();
    }
  });
});
