import { describe, expect, it } from "vitest";
import {
  openaiResponsesToOpenAIRequest,
} from "../../open-sse/translator/request/openai-responses.js";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";
import { initState, translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const EXEC_TOOL = {
  type: "custom",
  name: "exec",
  description: "Run JavaScript code to orchestrate tool calls.",
  format: {
    type: "grammar",
    syntax: "lark",
    definition: "start: /(.|\\n)+/",
  },
};

const WAIT_TOOL = {
  type: "function",
  name: "wait",
  description: "Pause before the next turn.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
};

describe("Codex Responses Lite custom tools → OpenAI Chat", () => {
  it("promotes additional_tools custom declarations into Chat tools", () => {
    const out = openaiResponsesToOpenAIRequest("cx/gpt-5.6-sol", {
      input: [
        { type: "additional_tools", role: "developer", tools: [EXEC_TOOL] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "Run pwd" }] },
      ],
      tool_choice: "auto",
    }, true, null);

    expect(out.tools).toHaveLength(1);
    expect(out.tools[0]).toMatchObject({
      type: "function",
      function: {
        name: "exec",
        parameters: {
          type: "object",
          required: ["input"],
          properties: { input: { type: "string" } },
        },
      },
    });
    expect(out._customToolNames).toEqual(["exec"]);
    expect(out.messages.some((message) => message.role === "developer")).toBe(false);
  });

  it("translates custom tool call/output history into Chat assistant/tool messages", () => {
    const program = "const result = await tools.shell({command: 'pwd'});\nreturn result;";
    const out = openaiResponsesToOpenAIRequest("cx/gpt-5.6-sol", {
      input: [
        { type: "additional_tools", role: "developer", tools: [EXEC_TOOL] },
        { type: "custom_tool_call", call_id: "call_exec_1", name: "exec", input: program },
        { type: "custom_tool_call_output", call_id: "call_exec_1", output: "/srv/app" },
        { type: "message", role: "user", content: [{ type: "input_text", text: "Continue" }] },
      ],
    }, true, null);

    const assistant = out.messages.find((message) => message.role === "assistant");
    expect(assistant.tool_calls[0]).toMatchObject({
      id: "call_exec_1",
      type: "function",
      function: { name: "exec" },
    });
    expect(JSON.parse(assistant.tool_calls[0].function.arguments)).toEqual({ input: program });
    expect(out.messages.find((message) => message.role === "tool")).toEqual({
      role: "tool",
      tool_call_id: "call_exec_1",
      content: "/srv/app",
    });
  });

  it("merges additional_tools with normal top-level function tools", () => {
    const out = openaiResponsesToOpenAIRequest("cx/gpt-5.6-sol", {
      input: [{ type: "additional_tools", role: "developer", tools: [EXEC_TOOL] }],
      tools: [{ type: "function", name: "search", parameters: { type: "object", properties: {} } }],
    }, true, null);

    expect(out.tools.map((tool) => tool.function.name)).toEqual(["search", "exec"]);
    expect(out._customToolNames).toEqual(["exec"]);
  });
});

describe("OpenAI Chat stream → Codex custom_tool_call", () => {
  it("unwraps the Chat input parameter and emits custom-tool events", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    state.customToolNames = new Set(["exec"]);
    const chunks = [
      {
        id: "chatcmpl-custom",
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_exec_2", type: "function", function: { name: "exec", arguments: "" } }] }, finish_reason: null }],
      },
      {
        id: "chatcmpl-custom",
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "{\"input\":\"const x = await tools.shell({command: 'pwd'});\"}" } }] }, finish_reason: null }],
      },
      { id: "chatcmpl-custom", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];

    const events = chunks.flatMap((chunk) => openaiToOpenAIResponsesResponse(chunk, state));
    const added = events.find((event) => event.event === "response.output_item.added");
    const delta = events.find((event) => event.event === "response.custom_tool_call_input.delta");
    const done = events.find((event) => event.event === "response.output_item.done");

    expect(added.data.item).toMatchObject({
      type: "custom_tool_call",
      call_id: "call_exec_2",
      name: "exec",
      input: "",
    });
    expect(delta.data.delta).toBe("const x = await tools.shell({command: 'pwd'});");
    expect(done.data.item).toMatchObject({
      type: "custom_tool_call",
      call_id: "call_exec_2",
      name: "exec",
      input: "const x = await tools.shell({command: 'pwd'});",
    });
    expect(events.some((event) => event.event === "response.function_call_arguments.delta")).toBe(false);
  });

  it("waits for the function name when id and name arrive in separate chunks", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    state.customToolNames = new Set(["exec"]);
    const chunks = [
      { id: "chatcmpl-split", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_split", type: "function", function: { arguments: "" } }] }, finish_reason: null }] },
      { id: "chatcmpl-split", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: "exec", arguments: "{\"input\":\"return 1;\"}" } }] }, finish_reason: null }] },
      { id: "chatcmpl-split", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];

    const events = chunks.flatMap((chunk) => openaiToOpenAIResponsesResponse(chunk, state));
    const added = events.filter((event) => event.event === "response.output_item.added");
    expect(added).toHaveLength(1);
    expect(added[0].data.item).toMatchObject({
      type: "custom_tool_call",
      call_id: "call_split",
      name: "exec",
    });
  });

  it("leaves normal Chat tool calls as Responses function_call events", () => {
    const state = initState(FORMATS.OPENAI_RESPONSES);
    state.customToolNames = new Set(["exec"]);
    const events = [
      { id: "chatcmpl-normal", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_search", type: "function", function: { name: "search", arguments: "{\"q\":\"x\"}" } }] }, finish_reason: null }] },
      { id: "chatcmpl-normal", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ].flatMap((chunk) => openaiToOpenAIResponsesResponse(chunk, state));

    expect(events.find((event) => event.event === "response.output_item.added").data.item.type).toBe("function_call");
    expect(events.find((event) => event.event === "response.output_item.done").data.item).toMatchObject({
      type: "function_call",
      name: "search",
      arguments: "{\"q\":\"x\"}",
    });
  });
});

describe("Codex Responses Lite passthrough → Responses upstream", () => {
  // A Responses client routed to a Responses provider skips every translator, so the
  // Codex-only additional_tools item used to reach chatgpt.com verbatim and fail the
  // whole request with `Unknown parameter: 'input[0].content'`.
  const body = () => ({
    model: "cx/gpt-5.6-sol",
    input: [
      {
        type: "additional_tools",
        role: "developer",
        tools: [{ type: "namespace", name: "functions", tools: [EXEC_TOOL, WAIT_TOOL] }],
      },
      { type: "message", role: "user", content: [{ type: "input_text", text: "Run pwd" }] },
    ],
  });
  const passthrough = (input) =>
    translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI_RESPONSES, "cx/gpt-5.6-sol", input, false);

  it("hoists additional_tools out of input and unwraps tool namespaces", () => {
    const out = passthrough(body());
    expect(out.input.map((item) => item.type)).toEqual(["message"]);
    expect(out.tools).toEqual([EXEC_TOOL, WAIT_TOOL]);
  });

  it("appends hoisted tools after tools the client already declared", () => {
    const out = passthrough({ ...body(), tools: [WAIT_TOOL] });
    expect(out.tools).toEqual([WAIT_TOOL, EXEC_TOOL, WAIT_TOOL]);
  });

  it("leaves a body carrying no additional_tools item untouched", () => {
    const out = passthrough({
      model: "cx/gpt-5.6-sol",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      tools: [EXEC_TOOL],
    });
    expect(out.input.map((item) => item.type)).toEqual(["message"]);
    expect(out.tools).toEqual([EXEC_TOOL]);
  });

  it("stops walking namespaces a client nested past the bound", () => {
    let deep = { type: "namespace", name: "leaf", tools: [EXEC_TOOL] };
    for (let level = 0; level < 12; level += 1) {
      deep = { type: "namespace", name: `level${level}`, tools: [deep] };
    }
    const out = passthrough({
      model: "cx/gpt-5.6-sol",
      input: [
        { type: "additional_tools", role: "developer", tools: [deep, WAIT_TOOL] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      ],
    });
    expect(out.tools).toEqual([WAIT_TOOL]);
  });

  it("drops an empty additional_tools item rather than declaring an empty tools[]", () => {
    const out = passthrough({
      model: "cx/gpt-5.6-sol",
      input: [
        { type: "additional_tools", role: "developer", tools: [] },
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
      ],
    });
    expect(out.input.map((item) => item.type)).toEqual(["message"]);
    expect(out.tools).toBeUndefined();
  });
});
