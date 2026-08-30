import { afterEach, describe, expect, it, vi } from "vitest";

import { CodexExecutor } from "../../open-sse/executors/codex.js";

function transform(input) {
  const body = {
    model: "gpt-5.6-sol",
    input,
    stream: true,
  };
  new CodexExecutor().transformRequest("gpt-5.6-sol", body, true, {
    connectionId: "orphan-output-test",
    providerSpecificData: {},
  });
  return body.input;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Codex orphaned tool outputs", () => {
  it("drops unmatched function, custom, and malformed output items", () => {
    const input = [
      { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
      { type: "function_call_output", call_id: "orphan-function", output: "secret-a" },
      { type: "custom_tool_call_output", call_id: "orphan-custom", output: "secret-b" },
      { type: "function_call_output", call_id: "", output: "empty" },
      { type: "custom_tool_call_output", output: "missing" },
      { type: "function_call_output", call_id: 42, output: "numeric" },
    ];

    expect(transform(input)).toEqual([input[0]]);
  });

  it("keeps correctly paired function and custom outputs with structured content", () => {
    const structured = [{ type: "input_text", text: "structured result" }];
    const result = transform([
      { type: "function_call", call_id: "fn-1", name: "read_file", arguments: "{}" },
      { type: "function_call_output", call_id: "fn-1", output: structured },
      { type: "custom_tool_call", call_id: "custom-1", name: "shell", input: "pwd" },
      { type: "custom_tool_call_output", call_id: "custom-1", output: "/srv/app" },
    ]);

    expect(result).toEqual([
      { type: "function_call", call_id: "fn-1", name: "read_file", arguments: "{}" },
      { type: "function_call_output", call_id: "fn-1", output: structured },
      { type: "custom_tool_call", call_id: "custom-1", name: "shell", input: "pwd" },
      { type: "custom_tool_call_output", call_id: "custom-1", output: "/srv/app" },
    ]);
  });

  it("drops duplicate outputs after the first valid result", () => {
    const result = transform([
      { type: "function_call", call_id: "fn-1", name: "read_file", arguments: "{}" },
      { type: "function_call_output", call_id: "fn-1", output: "first" },
      { type: "function_call_output", call_id: "fn-1", output: "duplicate" },
      { type: "custom_tool_call", call_id: "custom-1", name: "shell", input: "pwd" },
      { type: "custom_tool_call_output", call_id: "custom-1", output: "first" },
      { type: "custom_tool_call_output", call_id: "custom-1", output: "duplicate" },
    ]);

    expect(result.filter((item) => item.type?.endsWith("call_output"))).toEqual([
      { type: "function_call_output", call_id: "fn-1", output: "first" },
      { type: "custom_tool_call_output", call_id: "custom-1", output: "first" },
    ]);
  });

  it("recognizes Chat Completions assistant tool call IDs", () => {
    const result = transform([
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "chat-call", type: "function", function: { name: "read_file", arguments: "{}" } }],
      },
      { type: "function_call_output", call_id: "chat-call", output: "kept" },
      { type: "function_call_output", call_id: "other-call", output: "dropped" },
    ]);

    expect(result.filter((item) => item.type === "function_call_output")).toEqual([
      { type: "function_call_output", call_id: "chat-call", output: "kept" },
    ]);
  });

  it("does not mutate retained native items or log call IDs", () => {
    const input = [
      { type: "reasoning", id: "reasoning-local", summary: [] },
      { type: "function_call", call_id: "secret-call-id", name: "read_file", arguments: "{}" },
      { type: "function_call_output", call_id: "secret-call-id", output: "kept" },
      { type: "function_call_output", call_id: "secret-orphan-id", output: "dropped" },
    ];
    const snapshot = structuredClone(input);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = transform(input);

    expect(input).toEqual(snapshot);
    expect(result[0]).toBe(input[0]);
    expect(logSpy.mock.calls.flat().join(" ")).not.toMatch(/secret-(call|orphan)-id/);
  });

  it("leaves input unchanged when no output items are present", () => {
    const input = [
      { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] },
      { type: "function_call", call_id: "fn-1", name: "read_file", arguments: "{}" },
    ];

    expect(transform(input)).toEqual(input);
  });
});
