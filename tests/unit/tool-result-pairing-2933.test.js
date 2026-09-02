import { describe, expect, it } from "vitest";
import { fixMissingToolResponses } from "../../open-sse/translator/concerns/toolCall.js";

// Issues #2933 and #2338. The repair that fills in missing tool results was
// wrong three ways: it stopped at the first matching id, so a turn with six
// calls and one result looked answered; it inspected only the immediately next
// message, though results routinely span a run; and it always injected an
// OpenAI role:"tool" message, which a Claude body drops, leaving the tool_use
// as unanswered as before.

const openaiTurn = (ids) => ({
  role: "assistant",
  content: null,
  tool_calls: ids.map((id) => ({ id, type: "function", function: { name: "Bash", arguments: "{}" } })),
});
const openaiResult = (id) => ({ role: "tool", tool_call_id: id, content: "ok" });

const claudeTurn = (ids) => ({
  role: "assistant",
  content: ids.map((id) => ({ type: "tool_use", id, name: "Bash", input: {} })),
});
const claudeResults = (ids) => ({
  role: "user",
  content: ids.map((id) => ({ type: "tool_result", tool_use_id: id, content: "ok" })),
});

const run = (messages) => fixMissingToolResponses({ messages }).messages;
const answeredIds = (messages) => {
  const ids = new Set();
  for (const m of messages) {
    if (m.role === "tool" && m.tool_call_id) ids.add(m.tool_call_id);
    if (m.role === "user" && Array.isArray(m.content)) {
      for (const b of m.content) if (b?.type === "tool_result") ids.add(b.tool_use_id);
    }
  }
  return ids;
};

describe("tool result pairing repair (#2933, #2338)", () => {
  it("answers every call when only one of several was answered", () => {
    const out = run([openaiTurn(["a", "b", "c"]), openaiResult("a"), { role: "user", content: "next" }]);
    expect(answeredIds(out)).toEqual(new Set(["a", "b", "c"]));
  });

  it("does not duplicate answers that already exist across a run", () => {
    const out = run([openaiTurn(["a", "b"]), openaiResult("a"), openaiResult("b"), { role: "user", content: "next" }]);
    const answers = out.filter((m) => m.role === "tool");
    expect(answers).toHaveLength(2);
    expect(answeredIds(out)).toEqual(new Set(["a", "b"]));
  });

  it("repairs a Claude turn with tool_result blocks, not an OpenAI tool message", () => {
    const out = run([claudeTurn(["a", "b"]), claudeResults(["a"]), { role: "user", content: "next" }]);
    expect(out.some((m) => m.role === "tool")).toBe(false);
    expect(answeredIds(out)).toEqual(new Set(["a", "b"]));
  });

  it("keeps a Claude turn's results in one user message", () => {
    const out = run([claudeTurn(["a", "b"]), claudeResults(["a"]), { role: "user", content: "next" }]);
    const withResults = out.filter((m) => m.role === "user" && Array.isArray(m.content)
      && m.content.some((b) => b?.type === "tool_result"));
    expect(withResults).toHaveLength(1);
  });

  it("opens a user message when a Claude turn has no results at all", () => {
    const out = run([claudeTurn(["a"]), { role: "user", content: "next" }]);
    expect(out.some((m) => m.role === "tool")).toBe(false);
    expect(answeredIds(out)).toEqual(new Set(["a"]));
  });

  it("leaves a fully answered turn untouched", () => {
    const input = [openaiTurn(["a", "b"]), openaiResult("a"), openaiResult("b")];
    expect(run([...input])).toHaveLength(3);
  });

  it("leaves a message with no tool calls alone", () => {
    const out = run([{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }]);
    expect(out).toHaveLength(2);
  });
});
