import { describe, expect, it } from "vitest";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

// Tool arguments are buffered per index and emitted as one input_json_delta at
// finish. The buffer used to be written only when a block was already open for
// that index, and a block opens only on the chunk that carries the tool id. A
// provider that puts an argument fragment on an earlier chunk therefore had
// that fragment dropped, and the client received a tool input missing its
// opening bytes — which does not parse, and surfaces as InputValidationError.

const state = () => ({ toolCalls: new Map(), nextBlockIndex: 0 });
const chunk = (delta, finish = null) => ({
  id: "chatcmpl-1", model: "m",
  choices: [{ index: 0, delta, finish_reason: finish }],
});
const argsOf = (events) =>
  events.filter((e) => e?.delta?.type === "input_json_delta").map((e) => e.delta.partial_json).join("");

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

describe("tool argument fragments arriving before the tool id (#3416)", () => {
  it("keeps a fragment that arrives before the id chunk", () => {
    const out = run([
      chunk({ tool_calls: [{ index: 0, function: { arguments: '{"command":"echo ' } }] }),
      chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "Bash", arguments: 'hi' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '"}' } }] }),
      chunk({}, "tool_calls"),
    ]);

    const args = argsOf(out);
    expect(args).toBe('{"command":"echo hi"}');
    expect(() => JSON.parse(args)).not.toThrow();
  });

  it("still buffers normally when the id leads, the common case", () => {
    const out = run([
      chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "Bash", arguments: '{"command":"' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: 'ls -la' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '"}' } }] }),
      chunk({}, "tool_calls"),
    ]);

    expect(argsOf(out)).toBe('{"command":"ls -la"}');
  });

  it("preserves escaped quotes and shell metacharacters across fragments", () => {
    const payload = '{"command":"grep -rl \\"118\\" docs | head ; echo \\"---\\""}';
    const parts = [payload.slice(0, 12), payload.slice(12, 30), payload.slice(30)];
    const out = run([
      chunk({ tool_calls: [{ index: 0, function: { arguments: parts[0] } }] }),
      chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "Bash", arguments: parts[1] } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: parts[2] } }] }),
      chunk({}, "tool_calls"),
    ]);

    const args = argsOf(out);
    expect(JSON.parse(args).command).toContain('grep -rl "118" docs');
    expect(args).toBe(payload);
  });

  it("keeps two concurrent tool calls in their own buffers", () => {
    const out = run([
      chunk({ tool_calls: [{ index: 0, function: { arguments: '{"a":' } }] }),
      chunk({ tool_calls: [{ index: 1, function: { arguments: '{"b":' } }] }),
      chunk({ tool_calls: [{ index: 0, id: "c0", function: { name: "Bash", arguments: '1}' } }] }),
      chunk({ tool_calls: [{ index: 1, id: "c1", function: { name: "Read", arguments: '2}' } }] }),
      chunk({}, "tool_calls"),
    ]);

    const deltas = out.filter((e) => e?.delta?.type === "input_json_delta").map((e) => e.delta.partial_json);
    expect(deltas).toContain('{"a":1}');
    expect(deltas).toContain('{"b":2}');
  });
});

// The other half of the same failure: buffers are flushed once, by the first
// chunk carrying a finish_reason, and the tool block is closed in the same
// pass. A fragment that arrives after that has no block left to go into, so the
// client keeps a truncated argument string — the "cut off mid-string and never
// closed" shape #3416 reports. Nothing can deliver it late; what changed is
// that the drop is no longer silent.
describe("a fragment arriving after the stream terminal is reported (#3416)", () => {
  it("warns, naming the index and the size of what was lost", async () => {
    const { vi } = await import("vitest");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = state();
    openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "Bash", arguments: '{"command":"ls' } }] }), s);
    openaiToClaudeResponse(chunk({}, "tool_calls"), s);
    openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, function: { arguments: ' -la"}' } }] }), s);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("truncated");
    warn.mockRestore();
  });

  it("stays quiet when every fragment arrives before the terminal", async () => {
    const { vi } = await import("vitest");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = state();
    openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, id: "call_1", function: { name: "Bash", arguments: '{"command":"ls' } }] }), s);
    openaiToClaudeResponse(chunk({ tool_calls: [{ index: 0, function: { arguments: ' -la"}' } }] }), s);
    openaiToClaudeResponse(chunk({}, "tool_calls"), s);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
