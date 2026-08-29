import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { translateNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");
const { createSSETransformStreamWithLogger } = await import("../../open-sse/utils/stream.js");

// A chat.completion body as returned by a chat-native upstream (e.g. op-ericding)
const CHAT_TOOL_BODY = {
  id: "chatcmpl-abc123",
  object: "chat.completion",
  created: 1700000000,
  model: "cl/claude-haiku-4-5",
  choices: [{
    index: 0,
    message: {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call_1", type: "function", function: { name: "shell", arguments: "{\"cmd\":\"ls\"}" } }]
    },
    finish_reason: "tool_calls"
  }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
};

describe("non-stream Chat upstream for a Responses-API client (op-ericding bug)", () => {
  it("translates chat.completion tool_calls into Responses function_call output", () => {
    // translateNonStreamingResponse(body, targetFormat=PROVIDER format, sourceFormat=CLIENT format)
    const out = translateNonStreamingResponse(CHAT_TOOL_BODY, FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES);
    expect(out.object).toBe("response");
    expect(out).not.toHaveProperty("choices");
    const fc = (out.output || []).find((o) => o.type === "function_call");
    expect(fc).toBeTruthy();
    expect(fc.call_id).toBe("call_1");
    expect(fc.name).toBe("shell");
    expect(fc.arguments).toBe("{\"cmd\":\"ls\"}");
  });

  it("translates marked Chat tools into Responses custom_tool_call output", () => {
    const customBody = structuredClone(CHAT_TOOL_BODY);
    customBody.choices[0].message.tool_calls[0] = {
      id: "call_exec",
      type: "function",
      function: {
        name: "exec",
        arguments: "{\"input\":\"return await tools.shell({command: 'pwd'});\"}"
      }
    };
    const out = translateNonStreamingResponse(
      customBody,
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      new Set(["exec"])
    );
    const call = (out.output || []).find((item) => item.type === "custom_tool_call");
    expect(call).toMatchObject({
      call_id: "call_exec",
      name: "exec",
      input: "return await tools.shell({command: 'pwd'});"
    });
    expect(out.output.some((item) => item.type === "function_call")).toBe(false);
  });

  it("keeps chat.completion text content as a Responses message item", () => {
    const body = {
      ...CHAT_TOOL_BODY,
      choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }]
    };
    const out = translateNonStreamingResponse(body, FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES);
    const msg = (out.output || []).find((o) => o.type === "message");
    expect(msg).toBeTruthy();
    expect(msg.content[0].type).toBe("output_text");
    expect(msg.content[0].text).toBe("hello");
  });

  it("chains Antigravity response conversion into Responses output", () => {
    const body = {
      response: {
        responseId: "ag-resp-1",
        modelVersion: "gemini-3.7-flash-low",
        candidates: [{
          content: { parts: [{ text: "hello from antigravity" }] },
          finishReason: "STOP",
        }],
      },
    };
    const out = translateNonStreamingResponse(body, FORMATS.ANTIGRAVITY, FORMATS.OPENAI_RESPONSES);

    expect(out.object).toBe("response");
    expect(out).not.toHaveProperty("choices");
    const msg = (out.output || []).find((item) => item.type === "message");
    expect(msg?.content?.[0]).toMatchObject({
      type: "output_text",
      text: "hello from antigravity",
    });
  });

  it("leaves chat->chat untouched", () => {
    const out = translateNonStreamingResponse(CHAT_TOOL_BODY, FORMATS.OPENAI, FORMATS.OPENAI);
    expect(out.object).toBe("chat.completion");
    expect(out.choices[0].message.tool_calls[0].function.name).toBe("shell");
  });
});

describe("Antigravity streaming tool calls for a Responses-API client", () => {
  it("emits a Responses function_call instead of an empty stream", async () => {
    const encoder = new TextEncoder();
    const raw = [
      'data: {"response":{"responseId":"ag-tool","modelVersion":"gemini-3.7-flash-low","candidates":[{"content":{"parts":[{"functionCall":{"name":"read_file","args":{"path":"README.md"},"thoughtSignature":"sig"}}]}}]}}',
      'data: {"response":{"responseId":"ag-tool","modelVersion":"gemini-3.7-flash-low","candidates":[{"content":{"parts":[]},"finishReason":"STOP"}]}}',
      "data: [DONE]",
      ""
    ].join("\n\n");
    const input = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(raw));
        controller.close();
      }
    });
    const output = input.pipeThrough(createSSETransformStreamWithLogger(
      FORMATS.ANTIGRAVITY,
      FORMATS.OPENAI_RESPONSES,
      "antigravity",
      { appendProviderChunk() {}, appendConvertedChunk() {} },
      null,
      "gemini-3.7-flash-low",
      "test-connection",
      { messages: [] },
      null,
      "test-key",
    ));
    const text = await new Response(output).text();
    expect(text).toContain('"type":"response.output_item.added"');
    expect(text).toContain('"type":"function_call"');
    expect(text).toContain('"name":"read_file"');
    expect(text).toContain('"type":"response.completed"');
    const completedLine = text.split("\n").find((line) => line.startsWith("data: {") && line.includes('"type":"response.completed"'));
    const completed = JSON.parse(completedLine.slice(6));
    expect(completed.response.output).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "function_call",
        name: "read_file",
        arguments: '{"path":"README.md"}',
      }),
    ]));
  });
});

<<<<<<< HEAD
const RESPONSES_TEXT_BODY = {
  id: "resp_test123",
  object: "response",
  created_at: 1700000000,
  model: "some-model",
  output: [{
    id: "msg_1",
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: "OK", annotations: [] }]
  }],
  usage: { prompt_tokens: 6, completion_tokens: 2, total_tokens: 8 }
};

describe("non-stream Responses-API upstream for a Chat/Claude client", () => {
  it("translates Responses output text into chat.completion content for an OpenAI-chat client", () => {
    const out = translateNonStreamingResponse(RESPONSES_TEXT_BODY, FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI);
    expect(out.object).toBe("chat.completion");
    expect(out.choices[0].message.content).toBe("OK");
    expect(out.choices[0].finish_reason).toBe("stop");
  });

  it("translates Responses output text into Claude message content for a Claude client", () => {
    const out = translateNonStreamingResponse(RESPONSES_TEXT_BODY, FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE);
    expect(out.type).toBe("message");
    const textBlock = (out.content || []).find((b) => b.type === "text");
    expect(textBlock?.text).toBe("OK");
  });

  it("translates a Responses function_call into a Claude tool_use block", () => {
    const body = {
      ...RESPONSES_TEXT_BODY,
      output: [{ type: "function_call", id: "fc_1", call_id: "call_1", name: "shell", arguments: "{\"cmd\":\"ls\"}" }]
    };
    const out = translateNonStreamingResponse(body, FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE);
    const toolUse = (out.content || []).find((b) => b.type === "tool_use");
    expect(toolUse).toMatchObject({ name: "shell", input: { cmd: "ls" } });
  });
});

||||||| c44653872
=======
// A Responses API body as returned by a non-streaming `apiType: "responses"`
// upstream (e.g. a custom OpenAI-compatible provider like SLG/singularityapi).
const RESPONSES_TEXT_BODY = {
  id: "resp_test123",
  object: "response",
  created_at: 1700000000,
  model: "some-model",
  output: [{
    id: "msg_1",
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: "OK", annotations: [] }]
  }],
  usage: { prompt_tokens: 6, completion_tokens: 2, total_tokens: 8 }
};

describe("non-stream Responses-API upstream for a Chat/Claude client", () => {
  it("translates Responses output text into chat.completion content for an OpenAI-chat client", () => {
    const out = translateNonStreamingResponse(RESPONSES_TEXT_BODY, FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI);
    expect(out.object).toBe("chat.completion");
    expect(out.choices[0].message.content).toBe("OK");
    expect(out.choices[0].finish_reason).toBe("stop");
  });

  it("translates Responses output text into Claude message content for a Claude client", () => {
    const out = translateNonStreamingResponse(RESPONSES_TEXT_BODY, FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE);
    expect(out.type).toBe("message");
    const textBlock = (out.content || []).find((b) => b.type === "text");
    expect(textBlock?.text).toBe("OK");
  });

  it("translates a Responses function_call into a Claude tool_use block", () => {
    const body = {
      ...RESPONSES_TEXT_BODY,
      output: [{ type: "function_call", id: "fc_1", call_id: "call_1", name: "shell", arguments: "{\"cmd\":\"ls\"}" }]
    };
    const out = translateNonStreamingResponse(body, FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE);
    const toolUse = (out.content || []).find((b) => b.type === "tool_use");
    expect(toolUse).toMatchObject({ name: "shell", input: { cmd: "ls" } });
  });
});

>>>>>>> 90b29b182
describe("forced-SSE JSON path for a Responses-API client behind a chat upstream", () => {
  const sseCtx = (sourceFormat, targetFormat) => {
    const encoder = new TextEncoder();
    const raw = [
      'data: {"id":"chatcmpl-sse","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_9","type":"function","function":{"name":"shell","arguments":""}}]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-sse","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"cmd\\":\\"pwd\\"}"}}]},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-sse","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
      "data: [DONE]",
      ""
    ].join("\n\n");
    return {
      providerResponse: new Response(new ReadableStream({
        start(controller) { controller.enqueue(encoder.encode(raw)); controller.close(); }
      }), { headers: { "content-type": "text/event-stream" } }),
      sourceFormat,
      targetFormat,
      provider: "op-test-chat",
      model: "gpt-x",
      body: { model: "gpt-x", messages: [] },
      stream: false,
      requestStartTime: Date.now(),
      connectionId: "test-connection",
      clientRawRequest: { endpoint: "/v1/responses" },
      trackDone: vi.fn(),
      appendLog: vi.fn()
    };
  };

  it("parses chat SSE chunks and returns a Responses function_call body", async () => {
    const result = await handleForcedSSEToJson(sseCtx(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI));
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.object).toBe("response");
    const fc = (json.output || []).find((o) => o.type === "function_call");
    expect(fc).toBeTruthy();
    expect(fc.name).toBe("shell");
    expect(fc.arguments).toBe("{\"cmd\":\"pwd\"}");
  });

  it("returns a custom_tool_call for a marked tool", async () => {
    const ctx = sseCtx(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI);
    ctx.customToolNames = new Set(["shell"]);
    const result = await handleForcedSSEToJson(ctx);
    expect(result.success).toBe(true);
    const json = await result.response.json();
    const call = (json.output || []).find((item) => item.type === "custom_tool_call");
    expect(call).toMatchObject({
      call_id: "call_9",
      name: "shell",
      input: "{\"cmd\":\"pwd\"}"
    });
  });

  it("still returns chat.completion for a plain chat client", async () => {
    const result = await handleForcedSSEToJson(sseCtx(FORMATS.OPENAI, FORMATS.OPENAI));
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0].message.tool_calls[0].function.name).toBe("shell");
  });

  it("converts forced Antigravity SSE into Responses JSON", async () => {
    const encoder = new TextEncoder();
    const raw = [
      'data: {"response":{"responseId":"ag-sse","modelVersion":"gemini-3.7-flash-low","candidates":[{"content":{"parts":[{"text":"hello from stream"}]}}]}}',
      'data: {"response":{"responseId":"ag-sse","modelVersion":"gemini-3.7-flash-low","candidates":[{"content":{"parts":[]},"finishReason":"STOP"}]}}',
      "data: [DONE]",
      ""
    ].join("\n\n");
    const result = await handleForcedSSEToJson({
      providerResponse: new Response(new ReadableStream({
        start(controller) { controller.enqueue(encoder.encode(raw)); controller.close(); }
      }), { headers: { "content-type": "text/event-stream" } }),
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.ANTIGRAVITY,
      provider: "antigravity",
      model: "gemini-3.7-flash-low",
      body: { model: "combo-ui", input: "hello" },
      stream: false,
      translatedBody: null,
      finalBody: null,
      requestStartTime: Date.now(),
      connectionId: "test-connection",
      apiKey: "test-key",
      clientRawRequest: { endpoint: "/v1/responses" },
      onRequestSuccess: vi.fn(),
      customToolNames: null,
      trackDone: vi.fn(),
      appendLog: vi.fn(),
      reqTag: "test",
      log: null,
    });
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.object).toBe("response");
    expect(json.output?.[0]?.content?.[0]).toMatchObject({
      type: "output_text",
      text: "hello from stream",
    });
  });

  it("returns an Anthropic Message for a Claude-format client (forceStream provider)", async () => {
    // Reproduces the bug: Claude Code SDK gets "JSON but not a Message" when it
    // retries non-streaming against a provider with forceStream:true (e.g. openai,
    // zed, codebuddy-*). The fix must return type:"message", not object:"chat.completion".
    const result = await handleForcedSSEToJson(sseCtx(FORMATS.CLAUDE, FORMATS.OPENAI));
    expect(result.success).toBe(true);
    const json = await result.response.json();
    // Must be an Anthropic Message, not an OpenAI chat.completion
    expect(json.type).toBe("message");
    expect(json.role).toBe("assistant");
    expect(json).not.toHaveProperty("object");
    expect(json).not.toHaveProperty("choices");
    // Tool call must appear as a tool_use content block
    const tu = (json.content || []).find((b) => b.type === "tool_use");
    expect(tu).toBeTruthy();
    expect(tu.name).toBe("shell");
    expect(tu.input).toEqual({ cmd: "pwd" });
    // finish_reason "tool_calls" → stop_reason "tool_use" in Claude format
    expect(json.stop_reason).toBe("tool_use");
  });

  it("returns an Anthropic Message with text content for a Claude-format client", async () => {
    const encoder = new TextEncoder();
    const raw = [
      'data: {"id":"chatcmpl-txt","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}',
      'data: {"id":"chatcmpl-txt","object":"chat.completion.chunk","created":1700000000,"model":"gpt-x","choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}',
      "data: [DONE]",
      ""
    ].join("\n\n");
    const ctx = {
      providerResponse: new Response(new ReadableStream({
        start(controller) { controller.enqueue(encoder.encode(raw)); controller.close(); }
      }), { headers: { "content-type": "text/event-stream" } }),
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.OPENAI,
      provider: "openai",
      model: "gpt-x",
      body: { model: "gpt-x", messages: [] },
      stream: false,
      requestStartTime: Date.now(),
      connectionId: "test-conn",
      clientRawRequest: { endpoint: "/v1/messages" },
      trackDone: vi.fn(),
      appendLog: vi.fn()
    };
    const result = await handleForcedSSEToJson(ctx);
    expect(result.success).toBe(true);
    const json = await result.response.json();
    expect(json.type).toBe("message");
    expect(json.role).toBe("assistant");
    const textBlock = (json.content || []).find((b) => b.type === "text");
    expect(textBlock?.text).toBe("Hello world");
    expect(json.stop_reason).toBe("end_turn");
  });
});
