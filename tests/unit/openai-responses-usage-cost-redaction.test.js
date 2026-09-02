import { describe, expect, it, vi } from "vitest";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";

async function transformSameFormatResponses(events, onStreamComplete) {
  const input = `${events.join("\n\n")}\n\ndata: [DONE]\n\n`;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });

  const output = stream.pipeThrough(createSSETransformStreamWithLogger(
    FORMATS.OPENAI_RESPONSES,
    FORMATS.OPENAI_RESPONSES,
    "codex",
    null,
    null,
    "gpt-5.2-codex",
    "connection-1",
    { input: "hello" },
    onStreamComplete,
  ));

  const reader = output.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

describe("same-format OpenAI Responses exact-cost redaction", () => {
  it("retains terminal costs internally but omits them from the client SSE event", async () => {
    const onStreamComplete = vi.fn();
    const output = await transformSameFormatResponses([
      "event: response.completed\ndata: " + JSON.stringify({
        type: "response.completed",
        response: {
          id: "resp_1",
          status: "completed",
          usage: {
            input_tokens: 12,
            output_tokens: 3,
            total_tokens: 15,
            cost_usd: 0.25,
            cost_in_usd: 0.2,
            cost_in_usd_ticks: 2_500_000_000,
          },
        },
      }),
    ], onStreamComplete);

    expect(output).not.toContain("cost_usd");
    expect(output).not.toContain("cost_in_usd");
    expect(output).not.toContain("cost_in_usd_ticks");

    expect(onStreamComplete).toHaveBeenCalledTimes(1);
    const [, usage] = onStreamComplete.mock.calls[0];
    expect(usage).toMatchObject({
      prompt_tokens: 12,
      completion_tokens: 3,
      cost_usd: 0.25,
      cost_in_usd: 0.2,
      cost_in_usd_ticks: 2_500_000_000,
    });
  });
});
