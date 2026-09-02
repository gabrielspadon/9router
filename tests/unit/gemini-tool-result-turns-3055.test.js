/**
 * OpenAI→Gemini request translation lost tool results two ways (#3055).
 *
 * 1. `normalizeGeminiContents` merges consecutive same-role contents. A tool
 *    result becomes a USER content of functionResponse parts, so the user's
 *    NEXT text turn was folded into the very same content — Gemini then sees
 *    the functionResponse turn carrying free text and the answer for the call
 *    is no longer a turn of its own.
 * 2. The result cache is read with truthiness (`toolResponses[fid]`), so a tool
 *    that legitimately returns an empty string — a command with no output, a
 *    successful write — is treated as having produced nothing and its
 *    functionResponse is dropped entirely, leaving a functionCall Gemini never
 *    sees answered.
 */
import { describe, expect, it } from "vitest";
import { openaiToGeminiRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

const convert = (messages) => openaiToGeminiRequest("gemini-3-pro", { messages }, false);

const partsOf = (out, i) => out.contents[i].parts;
const funcResponses = (out) =>
  out.contents.flatMap((c) => c.parts.filter((p) => p.functionResponse).map((p) => p.functionResponse));

const CALL = {
  role: "assistant",
  tool_calls: [{ id: "call_1", type: "function", function: { name: "Bash", arguments: "{}" } }],
};

describe("Gemini tool-result turns (#3055)", () => {
  it("keeps a functionResponse turn separate from the user text that follows", () => {
    const out = convert([
      { role: "user", content: "run it" },
      CALL,
      { role: "tool", tool_call_id: "call_1", content: "done" },
      { role: "user", content: "now what" },
    ]);

    const responseTurn = out.contents.findIndex((c) => c.parts.some((p) => p.functionResponse));
    expect(responseTurn).toBeGreaterThan(-1);
    expect(partsOf(out, responseTurn).every((p) => p.functionResponse)).toBe(true);
    expect(out.contents.at(-1).parts).toEqual([{ text: "now what" }]);
  });

  it("keeps an empty-string tool result instead of dropping the response", () => {
    const out = convert([
      { role: "user", content: "run it" },
      CALL,
      { role: "tool", tool_call_id: "call_1", content: "" },
    ]);

    expect(funcResponses(out)).toHaveLength(1);
    expect(funcResponses(out)[0].id).toBe("call_1");
  });

  it("still merges ordinary consecutive user text turns", () => {
    const out = convert([
      { role: "user", content: "one" },
      { role: "user", content: "two" },
    ]);

    expect(out.contents).toHaveLength(1);
    expect(out.contents[0].parts).toEqual([{ text: "one" }, { text: "two" }]);
  });
});
