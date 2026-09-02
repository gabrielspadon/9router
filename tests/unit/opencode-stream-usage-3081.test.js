import { describe, expect, it } from "vitest";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";

function chatCompletionsBody(streamOptions) {
  const body = {
    model: "deepseek-v4-flash-free",
    messages: [{ role: "user", content: "Reply only OK" }],
  };
  if (streamOptions !== undefined) body.stream_options = streamOptions;
  return body;
}

describe("OpenCodeExecutor stream usage for PR #3081", () => {
  it("restores stream intent and requests usage for translated Chat Completions bodies", () => {
    const output = new OpenCodeExecutor().transformRequest(
      "deepseek-v4-flash-free",
      chatCompletionsBody(),
      true,
      {},
    );

    expect(output.stream).toBe(true);
    expect(output.stream_options).toEqual({ include_usage: true });
  });

  it("fills an undefined usage choice without discarding supplied stream options", () => {
    const output = new OpenCodeExecutor().transformRequest(
      "deepseek-v4-flash-free",
      chatCompletionsBody({ include_usage: undefined, include_obfuscation: true }),
      true,
      {},
    );

    expect(output.stream).toBe(true);
    expect(output.stream_options).toEqual({
      include_usage: true,
      include_obfuscation: true,
    });
  });

  it("preserves an explicit include_usage false choice", () => {
    const output = new OpenCodeExecutor().transformRequest(
      "deepseek-v4-flash-free",
      chatCompletionsBody({ include_usage: false }),
      true,
      {},
    );

    expect(output.stream).toBe(true);
    expect(output.stream_options).toEqual({ include_usage: false });
  });

  it("adds usage for a Claude client resolved onto the OpenAI Chat wire", () => {
    const output = new OpenCodeExecutor().transformRequest(
      "deepseek-v4-flash-free",
      chatCompletionsBody(),
      true,
      {},
      "claude",
      "openai",
    );

    expect(output.stream).toBe(true);
    expect(output.stream_options).toEqual({ include_usage: true });
  });

  it("does not add streaming fields to a resolved non-stream Chat Completions body", () => {
    const output = new OpenCodeExecutor().transformRequest(
      "deepseek-v4-flash-free",
      {
        model: "deepseek-v4-flash-free",
        messages: [{ role: "user", content: "Reply only OK" }],
        stream: false,
      },
      false,
      {},
    );

    expect(output).toEqual({
      model: "deepseek-v4-flash-free",
      messages: [{ role: "user", content: "Reply only OK" }],
      stream: false,
    });
  });

  it("does not add OpenAI stream fields to a non-OpenAI wire body", () => {
    const output = new OpenCodeExecutor().transformRequest(
      "deepseek-v4-flash-free",
      {
        request: {
          contents: [{ role: "user", parts: [{ text: "Reply only OK" }] }],
        },
      },
      true,
      {},
    );

    expect(output).toEqual({
      request: {
        contents: [{ role: "user", parts: [{ text: "Reply only OK" }] }],
      },
    });
  });

  it("does not add OpenAI stream fields to a direct Claude Messages body", () => {
    const output = new OpenCodeExecutor().transformRequest(
      "deepseek-v4-flash-free",
      {
        model: "deepseek-v4-flash-free",
        max_tokens: 64,
        system: "You are concise.",
        messages: [{ role: "user", content: [{ type: "text", text: "Reply only OK" }] }],
      },
      true,
      {},
      "claude",
      "claude",
    );

    expect(output.stream).toBeUndefined();
    expect(output.stream_options).toBeUndefined();
  });
});
