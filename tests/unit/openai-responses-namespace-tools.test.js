import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { initState } = await import("../../open-sse/translator/index.js");
const { openaiResponsesToOpenAIRequest } = await import("../../open-sse/translator/request/openai-responses.js");
const { openaiToOpenAIResponsesResponse } = await import("../../open-sse/translator/response/openai-responses.js");
const { createSSETransformStreamWithLogger } = await import("../../open-sse/utils/stream.js");
const { translateNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

const COLLABORATION = {
  type: "namespace",
  name: "collaboration",
  description: "Codex subagent tools",
  tools: [
    {
      type: "function",
      name: "spawn_agent",
      description: "Start a subagent.",
      parameters: { type: "object", properties: { task: { type: "string" } } },
    },
    {
      type: "function",
      name: "wait_agent",
      description: "Wait for a subagent.",
      parameters: { type: "object", properties: {} },
    },
  ],
};

const FUNCTIONS = {
  type: "namespace",
  name: "functions",
  tools: [{
    type: "custom",
    name: "exec",
    description: "Run a program.",
    format: { type: "grammar", syntax: "lark", definition: "start: /(.|\\n)+/" },
  }],
};

function translateTools(extra = {}) {
  return openaiResponsesToOpenAIRequest("cx/gpt-5.6-sol", {
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "delegate this" }] }],
    tools: [COLLABORATION, FUNCTIONS, {
      type: "function",
      name: "lookup",
      description: "A plain function.",
      parameters: { type: "object", properties: {} },
    }],
    ...extra,
  }, true, null);
}

function toolCallChunk(name, { id = "call_1", finish = null, argumentsText = "" } = {}) {
  return {
    id: "chatcmpl-namespace",
    choices: [{
      index: 0,
      delta: finish
        ? {}
        : { tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: argumentsText } }] },
      finish_reason: finish,
    }],
  };
}

function responsesState(translated) {
  const state = initState(FORMATS.OPENAI_RESPONSES);
  state.responsesToolNameMap = translated._responsesToolNameMap;
  state.customToolNames = new Set(translated._customToolNames || []);
  return state;
}

function chatCompletion(name) {
  return {
    id: "chatcmpl-namespace",
    object: "chat.completion",
    created: 1700000000,
    model: "test-model",
    choices: [{
      index: 0,
      message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name, arguments: "{}" } }] },
      finish_reason: "tool_calls",
    }],
  };
}

describe("Responses namespace tools across Chat transports", () => {
  it("expands declared namespaces into strict-provider-safe functions with request-scoped metadata", () => {
    const translated = translateTools();

    expect(translated.tools.map((tool) => tool.function.name)).toEqual([
      "collaboration__spawn_agent",
      "collaboration__wait_agent",
      "functions__exec",
      "lookup",
    ]);
    expect(translated._customToolNames).toEqual(["functions__exec"]);
    expect(translated._responsesToolNameMap).toBeInstanceOf(Map);
  });

  it("keeps a direct function distinct when its name collides with a flattened namespace tool", () => {
    const translated = openaiResponsesToOpenAIRequest("cx/gpt-5.6-sol", {
      input: [],
      tools: [COLLABORATION, {
        type: "function",
        name: "collaboration__spawn_agent",
        description: "A literal top-level name.",
        parameters: { type: "object", properties: {} },
      }],
    }, true, null);

    expect(translated.tools.map((tool) => tool.function.name)).toEqual([
      "collaboration__spawn_agent",
      "collaboration__wait_agent",
      "collaboration__spawn_agent__9r1",
    ]);
    expect(translated._responsesToolNameMap.get("collaboration__spawn_agent")).toMatchObject({
      name: "spawn_agent",
      namespace: "collaboration",
    });
    expect(translated._responsesToolNameMap.get("collaboration__spawn_agent__9r1")).toMatchObject({
      name: "collaboration__spawn_agent",
      namespace: null,
    });
  });

  it("maps a namespace tool_choice to the safe Chat function declaration", () => {
    const translated = translateTools({
      tool_choice: { type: "function", name: "spawn_agent", namespace: "collaboration" },
    });

    expect(translated.tool_choice).toEqual({
      type: "function",
      function: { name: "collaboration__spawn_agent" },
    });
  });

  it("recursively flattens bounded nested namespace leaves without declaring a synthetic group tool", () => {
    const translated = openaiResponsesToOpenAIRequest("cx/gpt-5.6-sol", {
      input: "nested",
      tools: [{
        type: "namespace",
        name: "outer",
        tools: [{
          type: "namespace",
          name: "inner",
          tools: [{
            type: "function",
            name: "leaf",
            description: "A nested leaf.",
            parameters: { type: "object", properties: {} },
          }],
        }],
      }],
    }, true, null);

    expect(translated.tools.map((tool) => tool.function.name)).toEqual(["outer__inner__leaf"]);
    expect(translated._responsesToolNameMap.get("outer__inner__leaf")).toMatchObject({
      name: "leaf",
      namespace: "outer.inner",
    });
  });

  it("rebuilds namespace and custom-tool identity for streamed Chat tool calls without leaking it to another request", () => {
    const translated = translateTools();
    const mappedState = responsesState(translated);
    const events = [
      toolCallChunk("collaboration__spawn_agent"),
      toolCallChunk("", { finish: "tool_calls" }),
    ].flatMap((chunk) => openaiToOpenAIResponsesResponse(chunk, mappedState));
    const added = events.find((event) => event.event === "response.output_item.added");
    const done = events.find((event) => event.event === "response.output_item.done");

    expect(added.data.item).toMatchObject({
      type: "function_call",
      name: "spawn_agent",
      namespace: "collaboration",
    });
    expect(done.data.item).toMatchObject({ name: "spawn_agent", namespace: "collaboration" });

    const flatState = responsesState(translated);
    const flat = [
      toolCallChunk("wait_agent"),
      toolCallChunk("", { finish: "tool_calls" }),
    ].flatMap((chunk) => openaiToOpenAIResponsesResponse(chunk, flatState));
    expect(flat.find((event) => event.event === "response.output_item.added").data.item).toMatchObject({
      name: "wait_agent",
      namespace: "collaboration",
    });

    const isolatedState = initState(FORMATS.OPENAI_RESPONSES);
    const isolated = [
      toolCallChunk("collaboration__spawn_agent"),
      toolCallChunk("", { finish: "tool_calls" }),
    ].flatMap((chunk) => openaiToOpenAIResponsesResponse(chunk, isolatedState));
    expect(isolated.find((event) => event.event === "response.output_item.added").data.item).toMatchObject({
      name: "collaboration__spawn_agent",
    });
    expect(isolated.find((event) => event.event === "response.output_item.added").data.item).not.toHaveProperty("namespace");
  });

  it("keeps the namespace mapping through ordinary JSON and forced-SSE JSON conversions", async () => {
    const translated = translateTools();
    const ordinary = translateNonStreamingResponse(
      chatCompletion("collaboration__spawn_agent"),
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      translated._customToolNames,
      translated._responsesToolNameMap,
    );
    expect(ordinary.output.find((item) => item.type === "function_call")).toMatchObject({
      name: "spawn_agent",
      namespace: "collaboration",
    });

    const encoded = new TextEncoder();
    const raw = [
      `data: ${JSON.stringify(toolCallChunk("exec", { argumentsText: JSON.stringify({ input: "return 1" }) }))}`,
      `data: ${JSON.stringify(toolCallChunk("", { finish: "tool_calls" }))}`,
      "data: [DONE]",
      "",
    ].join("\n\n");
    const forced = await handleForcedSSEToJson({
      providerResponse: new Response(new ReadableStream({
        start(controller) { controller.enqueue(encoded.encode(raw)); controller.close(); },
      }), { headers: { "content-type": "text/event-stream" } }),
      sourceFormat: FORMATS.OPENAI_RESPONSES,
      targetFormat: FORMATS.OPENAI,
      provider: "test-openai",
      model: "test-model",
      body: { model: "test-model", messages: [] },
      stream: false,
      requestStartTime: Date.now(),
      connectionId: "test-connection",
      clientRawRequest: { endpoint: "/v1/responses", body: {} },
      customToolNames: translated._customToolNames,
      responsesToolNameMap: translated._responsesToolNameMap,
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    });
    const forcedBody = await forced.response.json();
    expect(forcedBody.output.find((item) => item.type === "custom_tool_call")).toMatchObject({
      name: "exec",
      namespace: "functions",
      input: "return 1",
    });
  });

  it("carries namespace metadata through the streaming transform", async () => {
    const translated = translateTools();
    const encoded = new TextEncoder();
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue(encoded.encode([
          `data: ${JSON.stringify(toolCallChunk("collaboration__spawn_agent"))}`,
          `data: ${JSON.stringify(toolCallChunk("", { finish: "tool_calls" }))}`,
          "data: [DONE]",
          "",
        ].join("\n\n")));
        controller.close();
      },
    });
    const output = source.pipeThrough(createSSETransformStreamWithLogger(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      "test-openai",
      { appendProviderChunk() {}, appendConvertedChunk() {} },
      null,
      "test-model",
      "test-connection",
      { messages: [] },
      null,
      "test-key",
      translated._customToolNames,
      null,
      translated._responsesToolNameMap,
    ));
    const text = await new Response(output).text();
    const added = text.split("\n").find((line) => line.includes('"type":"response.output_item.added"'));
    expect(JSON.parse(added.slice(6)).item).toMatchObject({
      name: "spawn_agent",
      namespace: "collaboration",
    });
  });
});
