// #2512 — Codex CLI chat works through the router but the agent never runs a
// shell command. Client and provider are both Codex, so the request is a
// near-passthrough and every difference from the direct call comes from
// CodexExecutor.transformRequest. Two tool-governing fields were dropped there:
// the top-level parallel_tool_calls (allowlist) and per-tool strict (the
// function-tool rebuild wipes every key). Both are fields the official Codex CLI
// sends to this same endpoint, and open-sse/handlers/imageProviders/codex.js
// posts parallel_tool_calls to it directly, so neither can be "unknown" upstream.
import { describe, expect, it } from "vitest";

import { CodexExecutor } from "../../open-sse/executors/codex.js";

// A Codex-CLI-shaped Responses request: a freeform apply_patch tool, the shell
// function tool with optional params outside `required`, and the batching flag.
function codexCliBody(overrides = {}) {
  return {
    model: "gpt-5.5",
    instructions: "You are a coding agent running in the Codex CLI.",
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "list the repo" }] }],
    tools: [
      {
        type: "function",
        name: "shell",
        description: "Runs a shell command and returns its output.",
        strict: false,
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            command: { type: "array", items: { type: "string" } },
            workdir: { type: "string" },
            timeout_ms: { type: "number" },
          },
          required: ["command"],
        },
      },
    ],
    tool_choice: "auto",
    parallel_tool_calls: false,
    stream: true,
    store: false,
    ...overrides,
  };
}

function transform(body) {
  new CodexExecutor().transformRequest("gpt-5.5", body, true, {
    connectionId: "test-codex-2512",
    providerSpecificData: {},
  });
  return body;
}

describe("#2512 Codex request fidelity for tool-calling fields", () => {
  it("forwards the client's parallel_tool_calls instead of stripping it", () => {
    expect(transform(codexCliBody()).parallel_tool_calls).toBe(false);
    expect(transform(codexCliBody({ parallel_tool_calls: true })).parallel_tool_calls).toBe(true);
  });

  it("omits parallel_tool_calls when the client did not send one", () => {
    const body = codexCliBody();
    delete body.parallel_tool_calls;
    expect("parallel_tool_calls" in transform(body)).toBe(false);
  });

  it("keeps strict:false on a function tool whose optional params are not all required", () => {
    const [shell] = transform(codexCliBody()).tools;
    expect(shell.strict).toBe(false);
    // The rest of the flattening is unchanged.
    expect(shell).toMatchObject({ type: "function", name: "shell" });
    expect(shell.parameters.required).toEqual(["command"]);
  });

  it("reads strict:false off the nested Chat-Completions tool shape too", () => {
    const body = codexCliBody({
      tools: [{
        type: "function",
        function: {
          name: "shell",
          description: "Runs a shell command.",
          strict: false,
          parameters: { type: "object", properties: { command: { type: "string" } } },
        },
      }],
    });
    expect(transform(body).tools[0].strict).toBe(false);
  });

  it("does not invent strict when the client omitted it or asked for true", () => {
    const omitted = codexCliBody();
    delete omitted.tools[0].strict;
    expect("strict" in transform(omitted).tools[0]).toBe(false);

    // Forwarding true could newly reject a schema the upstream default accepted,
    // so only the relaxing value is carried over.
    const strictTrue = codexCliBody();
    strictTrue.tools[0].strict = true;
    expect("strict" in transform(strictTrue).tools[0]).toBe(false);
  });

  it("still strips fields the Codex upstream rejects", () => {
    const body = transform(codexCliBody({ max_output_tokens: 4096, metadata: { a: 1 }, user: "u" }));
    expect("max_output_tokens" in body).toBe(false);
    expect("metadata" in body).toBe(false);
    expect("user" in body).toBe(false);
  });
});
