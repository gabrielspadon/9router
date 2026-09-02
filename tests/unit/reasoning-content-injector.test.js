import { describe, expect, it } from "vitest";

import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { injectReasoningContent } from "../../open-sse/utils/reasoningContentInjector.js";

describe("Xiaomi reasoning-content echo", () => {
  it.each(["xiaomi-mimo", "xiaomi-tokenplan"])(
    "adds a placeholder for a missing assistant reasoning trace through %s",
    (provider) => {
      const body = {
        model: "mimo-v2.5-pro",
        messages: [
          { role: "user", content: "call a tool" },
          {
            role: "assistant",
            content: "",
            tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: "{}" } }],
          },
          { role: "tool", tool_call_id: "call_1", content: "ok" },
        ],
      };

      const result = injectReasoningContent({ provider, model: body.model, body });

      expect(result.messages[1].reasoning_content).toBe(" ");
      expect(body.messages[1]).not.toHaveProperty("reasoning_content");
    },
  );

  it("preserves Xiaomi reasoning_content returned by the model", () => {
    const result = injectReasoningContent({
      provider: "xiaomi-tokenplan",
      model: "mimo-v2.5-pro",
      body: {
        messages: [{ role: "assistant", content: "", reasoning_content: "actual reasoning" }],
      },
    });

    expect(result.messages[0].reasoning_content).toBe("actual reasoning");
  });

  it("does not add OpenAI reasoning_content to Xiaomi's Claude transport", () => {
    const executor = new DefaultExecutor("xiaomi-tokenplan");
    const result = executor.transformRequest(
      "mimo-v2.5-pro",
      {
        messages: [{ role: "assistant", content: [{ type: "text", text: "plain reply" }] }],
      },
      true,
      { runtimeTransport: { format: "claude" } },
      "claude",
    );

    expect(result.messages[0]).not.toHaveProperty("reasoning_content");
  });
});
