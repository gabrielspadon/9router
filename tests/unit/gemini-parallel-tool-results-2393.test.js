import { describe, expect, it } from "vitest";
import { geminiToOpenAIRequest } from "../../open-sse/translator/request/gemini-to-openai.js";

// Gemini emits one functionResponse part per parallel tool call inside a single
// content. convertGeminiContent returned on the first one, so every other result
// was dropped and the model answered having seen only one tool's output.
const convert = (contents) => geminiToOpenAIRequest("m", { contents }, false);
const toolMsgs = (out) => out.messages.filter((m) => m.role === "tool");

describe("parallel Gemini tool results all survive (#2393)", () => {
  it("keeps every functionResponse in one content", () => {
    const out = convert([
      { role: "user", parts: [{ text: "go" }] },
      { role: "user", parts: [
        { functionResponse: { id: "a", name: "f1", response: { result: "one" } } },
        { functionResponse: { id: "b", name: "f2", response: { result: "two" } } },
        { functionResponse: { id: "c", name: "f3", response: { result: "three" } } },
      ] },
    ]);
    expect(toolMsgs(out).map((m) => m.tool_call_id)).toEqual(["a", "b", "c"]);
  });

  it("carries each result's own payload, not the first repeated", () => {
    const out = convert([{ role: "user", parts: [
      { functionResponse: { id: "a", name: "f1", response: { result: "one" } } },
      { functionResponse: { id: "b", name: "f2", response: { result: "two" } } },
    ] }]);
    const [first, second] = toolMsgs(out);
    expect(first.content).toContain("one");
    expect(second.content).toContain("two");
  });

  it("a single result still produces a single message, unchanged", () => {
    const out = convert([{ role: "user", parts: [
      { functionResponse: { id: "only", name: "f", response: { result: "x" } } },
    ] }]);
    expect(toolMsgs(out)).toHaveLength(1);
    expect(toolMsgs(out)[0].tool_call_id).toBe("only");
  });

  it("falls back to a name-derived id when the part carries none", () => {
    const out = convert([{ role: "user", parts: [
      { functionResponse: { name: "namedFn", response: { result: "x" } } },
    ] }]);
    expect(toolMsgs(out)[0].tool_call_id).toBe("call_namedFn");
  });

  it("leaves ordinary text and tool calls alone", () => {
    const out = convert([
      { role: "user", parts: [{ text: "hello" }] },
      { role: "model", parts: [{ functionCall: { name: "f", args: {} } }] },
    ]);
    expect(toolMsgs(out)).toHaveLength(0);
    expect(JSON.stringify(out.messages)).toContain("hello");
  });
});
