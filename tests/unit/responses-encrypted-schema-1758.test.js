import { describe, expect, it } from "vitest";
import { translateRequest } from "../../open-sse/translator/index.js";

// Codex's multi_agent_v2 feature declares spawn_agent's `message` parameter as
// `encrypted: true`, a JSON-schema annotation only OpenAI's own encrypted-tool-
// parameter feature understands. A backend not provisioned for it rejects the
// whole request before the subagent can start: "Invalid Value: 'tools'. Function
// 'functions.spawn_agent' declares encrypted parameters but is not configured
// for encrypted tool use by this model." (#1758)
const SPAWN_AGENT = {
  type: "function",
  name: "spawn_agent",
  parameters: {
    type: "object",
    required: ["task_name", "message"],
    properties: {
      task_name: { type: "string" },
      message: { type: "string", encrypted: true },
      fork_turns: { type: "string" },
    },
  },
};

describe("a tool schema's `encrypted: true` does not 400 the request (#1758)", () => {
  it("strips encrypted on the same-format Responses passthrough", () => {
    // Codex's wire_api is "responses"; a Responses client routed to a Responses
    // upstream skips every request translator, so this is the path the report's
    // custom_responses_proxy config actually takes.
    const body = {
      model: "gpt-5.5",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Spawn 1 explorer subagent" }] }],
      tools: [SPAWN_AGENT],
    };
    const out = translateRequest("openai-responses", "openai-responses", "gpt-5.5", body, false, null, "codex");
    expect(JSON.stringify(out.tools)).not.toContain("encrypted");
    expect(out.tools[0].parameters.properties.message).toEqual({ type: "string" });
  });

  it("strips encrypted when pivoting Responses -> Chat Completions", () => {
    const body = {
      model: "gpt-5.5",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Spawn 1 explorer subagent" }] }],
      tools: [SPAWN_AGENT],
    };
    const out = translateRequest("openai-responses", "openai", "gpt-5.5", body, false, null, "codex");
    expect(JSON.stringify(out.tools)).not.toContain("encrypted");
    expect(out.tools[0].function.parameters.properties.message).toEqual({ type: "string" });
  });

  it("keeps the rest of the schema and the other tool declarations intact", () => {
    const body = {
      model: "gpt-5.5",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      tools: [SPAWN_AGENT],
    };
    const out = translateRequest("openai-responses", "openai-responses", "gpt-5.5", body, false, null, "codex");
    expect(out.tools[0].name).toBe("spawn_agent");
    expect(out.tools[0].parameters.required).toEqual(["task_name", "message"]);
    expect(out.tools[0].parameters.properties.task_name).toEqual({ type: "string" });
    expect(out.tools[0].parameters.properties.fork_turns).toEqual({ type: "string" });
  });

  it("does not mutate the caller's schema, which a combo reuses across providers", () => {
    const body = {
      model: "gpt-5.5",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      tools: [SPAWN_AGENT],
    };
    translateRequest("openai-responses", "openai-responses", "gpt-5.5", body, false, null, "codex");
    expect(SPAWN_AGENT.parameters.properties.message).toEqual({ type: "string", encrypted: true });
  });

  it("leaves a schema with no encrypted keyword completely untouched", () => {
    const plain = {
      type: "function",
      name: "wait_agent",
      parameters: { type: "object", properties: { task_name: { type: "string" } } },
    };
    const body = {
      model: "gpt-5.5",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
      tools: [plain],
    };
    const before = JSON.stringify(plain.parameters);
    const out = translateRequest("openai-responses", "openai-responses", "gpt-5.5", body, false, null, "codex");
    expect(JSON.stringify(out.tools[0].parameters)).toBe(before);
  });
});
