import { describe, expect, it } from "vitest";
import { canonicalizeKiroConversation } from "open-sse/translator/concerns/kiroConversation.js";

const M = "claude-sonnet-4.5";
// Returns { history, currentMessage, ... }; the flattened turn list is what the
// assertions care about, in wire order.
// Tool specs must be supplied or the canonicalizer treats the tool use as
// invalid and FLATTENS the results into text (repairs.orphanResults). That is
// correct behaviour for an unknown tool, but it is not the path this issue is
// about, so the calls below declare the tool they use.
const SPECS = [{ toolSpecification: { name: "calc", description: "d", inputSchema: { json: { type: "object" } } } }];
const run = (history, currentMessage, toolSpecs = SPECS) => {
  const r = canonicalizeKiroConversation({ history, currentMessage, modelId: M, toolSpecs });
  return [...(r.history || []), ...(r.currentMessage ? [r.currentMessage] : [])];
};

// In an agentic loop the turn after a tool_use carries only tool results and no
// user text — the payload lives in userInputMessageContext. Substituting the
// literal word "continue" made the model read a user instruction nobody typed,
// and it surfaced in the visible conversation on every tool turn (#2182).
describe("kiro does not fabricate a 'continue' instruction (#2182)", () => {
  const toolTurn = () => ({
    userInputMessage: {
      content: "",
      modelId: M,
      userInputMessageContext: {
        toolResults: [{ toolUseId: "t1", status: "success", content: [{ text: "42" }] }],
      },
    },
  });

  it("a tool-result turn is not given a user instruction", () => {
    const turns = run(
      [
        { userInputMessage: { content: "what is 6*7", modelId: M } },
        { assistantResponseMessage: { content: "", toolUses: [{ toolUseId: "t1", name: "calc", input: {} }] } },
      ],
      toolTurn()
    );
    const last = turns.at(-1).userInputMessage;
    expect(last.content).not.toBe("continue");
    expect(last.content).toBe("...");
  });

  it("the tool results themselves survive", () => {
    // The whole point of the turn; a placeholder change must not disturb it.
    const turns = run(
      [
        { userInputMessage: { content: "q", modelId: M } },
        { assistantResponseMessage: { content: "", toolUses: [{ toolUseId: "t1", name: "calc", input: {} }] } },
      ],
      toolTurn()
    );
    const last = turns.at(-1).userInputMessage;
    expect(last.userInputMessageContext.toolResults).toHaveLength(1);
    expect(last.userInputMessageContext.toolResults[0].toolUseId).toBe("t1");
  });

  it("real user text is never replaced", () => {
    const turns = run([], { userInputMessage: { content: "hello there", modelId: M } });
    expect(turns.at(-1).userInputMessage.content).toBe("hello there");
  });

  it("a genuinely bare turn still says continue", () => {
    // The structural inserts exist so the conversation does not start or end on
    // the assistant, and there the model really is being asked to carry on.
    const turns = run([{ assistantResponseMessage: { content: "half an answer" } }], null, []);
    expect(turns[0].userInputMessage.content).toBe("continue");
  });

  it("content is never empty, which is what the fallback is for", () => {
    const turns = run(
      [
        { userInputMessage: { content: "q", modelId: M } },
        { assistantResponseMessage: { content: "", toolUses: [{ toolUseId: "t1", name: "calc", input: {} }] } },
      ],
      toolTurn()
    );
    for (const t of turns) {
      const c = t.userInputMessage?.content ?? t.assistantResponseMessage?.content;
      expect(typeof c).toBe("string");
      expect(c.length).toBeGreaterThan(0);
    }
  });
});
