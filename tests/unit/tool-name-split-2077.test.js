import { describe, expect, it } from "vitest";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

// Issue #2077. The Claude tool_use block carries the tool name in
// content_block_start, which cannot be revised once emitted. The block opened
// as soon as an id appeared, so a provider that sends the id on one chunk and
// the name on a later one (GLM 5.2 does) froze `name: ""`, and the client
// received a tool call it had no way to dispatch.

const state = () => ({ toolCalls: new Map(), nextBlockIndex: 0 });
const chunk = (delta, finish = null) => ({
  id: "chatcmpl-1", model: "m",
  choices: [{ index: 0, delta, finish_reason: finish }],
});

function run(chunks) {
  const s = state();
  const out = [];
  for (const c of chunks) {
    const r = openaiToClaudeResponse(c, s);
    if (Array.isArray(r)) out.push(...r);
    else if (r) out.push(r);
  }
  return out;
}

const starts = (out) => out.filter((e) => e?.type === "content_block_start" && e.content_block?.type === "tool_use");
const argsOf = (out) => out.filter((e) => e?.delta?.type === "input_json_delta").map((e) => e.delta.partial_json).join("");

describe("tool name arriving after the tool id (#2077)", () => {
  it("uses the real name when the id leads and the name follows", () => {
    const out = run([
      chunk({ tool_calls: [{ index: 0, id: "call_1", function: { arguments: "" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { name: "Bash", arguments: '{"command":"ls"}' } }] }),
      chunk({}, "tool_calls"),
    ]);

    expect(starts(out)).toHaveLength(1);
    expect(starts(out)[0].content_block.name).toBe("Bash");
    expect(starts(out)[0].content_block.id).toBe("call_1");
    expect(argsOf(out)).toBe('{"command":"ls"}');
  });

  it("still opens once when id and name arrive together", () => {
    const out = run([
      chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "Bash", arguments: '{"a":' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: "1}" } }] }),
      chunk({}, "tool_calls"),
    ]);

    expect(starts(out)).toHaveLength(1);
    expect(starts(out)[0].content_block.name).toBe("Bash");
    expect(argsOf(out)).toBe('{"a":1}');
  });

  it("does not repeat the block when the name is echoed on later chunks", () => {
    const out = run([
      chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "Bash", arguments: "" } }] }),
      chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "Bash", arguments: "{}" } }] }),
      chunk({}, "tool_calls"),
    ]);

    expect(starts(out)).toHaveLength(1);
  });

  it("still emits a call whose name never arrives rather than dropping it", () => {
    const out = run([
      chunk({ tool_calls: [{ index: 0, id: "call_1", function: { arguments: '{"a":1}' } }] }),
      chunk({}, "tool_calls"),
    ]);

    const s = starts(out);
    expect(s).toHaveLength(1);
    expect(s[0].content_block.id).toBe("call_1");
    expect(argsOf(out)).toBe('{"a":1}');
  });

  it("keeps two calls distinct when their names arrive out of order", () => {
    const out = run([
      chunk({ tool_calls: [{ index: 0, id: "c0", function: { arguments: "" } }] }),
      chunk({ tool_calls: [{ index: 1, id: "c1", function: { name: "Read", arguments: "" } }] }),
      chunk({ tool_calls: [{ index: 0, function: { name: "Bash", arguments: "" } }] }),
      chunk({}, "tool_calls"),
    ]);

    const byId = Object.fromEntries(starts(out).map((e) => [e.content_block.id, e.content_block.name]));
    expect(byId).toEqual({ c0: "Bash", c1: "Read" });
  });
});
