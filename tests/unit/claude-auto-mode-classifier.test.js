import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleForcedSSEToJson } = await import(
  "../../open-sse/handlers/chatCore/sseToJsonHandler.js"
);

const SYSTEM_PREFIX =
  "You are a security monitor for autonomous AI coding agents";
const STAGE_ONE_BODY = Object.freeze({
  model: "subscription",
  stream: false,
  system: `${SYSTEM_PREFIX}. Return one exact decision.`,
  stop_sequences: ["</block>"],
  messages: [{ role: "user", content: "Classify this action." }],
});
const CLASSIFIER_ERROR = {
  error: {
    message:
      "Claude Code classifier returned an invalid decision; expected exactly <block>no</block> or <block>yes</block>.",
    type: "server_error",
    code: "bad_gateway",
  },
};

const textItem = (text) => ({
  type: "message",
  role: "assistant",
  content: [{ type: "output_text", text }],
});
const frame = (event, data, eol = "\n") =>
  `event: ${event}${eol}data: ${JSON.stringify(data)}${eol}${eol}`;
const doneFrame = (item, outputIndex = 0, eol = "\n") =>
  frame(
    "response.output_item.done",
    { type: "response.output_item.done", output_index: outputIndex, item },
    eol,
  );
const terminalFrame = (output, eol = "\n") =>
  frame(
    "response.completed",
    {
      type: "response.completed",
      response: {
        id: "resp_classifier_1700000000",
        created_at: 1700000000,
        model: "gpt-5.6-sol",
        status: "completed",
        ...(output === undefined ? {} : { output }),
        usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 },
      },
    },
    eol,
  );
const readableFromChunks = (chunks) =>
  new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
const forcedResponsesContext = (body, chunks) => ({
  providerResponse: new Response(readableFromChunks(chunks), {
    headers: { "content-type": "text/event-stream" },
  }),
  sourceFormat: FORMATS.CLAUDE,
  targetFormat: FORMATS.OPENAI_RESPONSES,
  provider: "codex",
  model: "gpt-5.6-sol",
  body,
  stream: false,
  translatedBody: null,
  finalBody: null,
  requestStartTime: 1700000000000,
  connectionId: "classifier-test-connection",
  apiKey: "classifier-test-key",
  clientRawRequest: { endpoint: "/v1/messages", body },
  onRequestSuccess: vi.fn(async () => {}),
  customToolNames: null,
  trackDone: vi.fn(),
  appendLog: vi.fn(),
  reqTag: "classifier-test",
  log: null,
});

describe("Claude Code response classifier validation", () => {
  it("rejects malformed classifier prose from forced Responses SSE", async () => {
    const result = await handleForcedSSEToJson(
      forcedResponsesContext(STAGE_ONE_BODY, [
        doneFrame(textItem("This looks safe to me.")),
        terminalFrame(),
      ]),
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(await result.response.json()).toEqual(CLASSIFIER_ERROR);
  });
});
