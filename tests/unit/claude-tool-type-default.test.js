/**
 * Strict Anthropic-compatible gateways (MiniMax's /anthropic/v1/messages,
 * error 2013) reject a Claude-format request whose tools[] entries omit
 * `type` with HTTP 400. Default the field to "custom" on the final body when
 * the request is dispatched in Claude format; anything that already declares a
 * type (computer_use, bash, web_search_*) is passed through untouched.
 *
 * Upstream: e08ac6dad.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { defaultClaudeToolType } from "../../open-sse/translator/concerns/toolCall.js";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: executeMock }),
}));

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

vi.mock("../../open-sse/utils/stream.js", () => ({
  COLORS: { red: "", reset: "" },
  createPassthroughStreamWithLogger: vi.fn(() => new TransformStream()),
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

describe("defaultClaudeToolType", () => {
  it("defaults a missing type to custom", () => {
    const out = defaultClaudeToolType([{ name: "echo", input_schema: { type: "object" } }]);
    expect(out[0]).toEqual({ name: "echo", input_schema: { type: "object" }, type: "custom" });
  });

  it("defaults falsy types (null, undefined, empty string) to custom", () => {
    const out = defaultClaudeToolType([
      { name: "a", type: null },
      { name: "b", type: undefined },
      { name: "c", type: "" },
    ]);
    expect(out.map((t) => t.type)).toEqual(["custom", "custom", "custom"]);
  });

  it("leaves a tool that already declares a type untouched", () => {
    const builtin = { name: "computer", type: "computer_20250124" };
    const out = defaultClaudeToolType([builtin]);
    expect(out[0]).toBe(builtin);
  });

  it("returns a non-array unchanged", () => {
    expect(defaultClaudeToolType(undefined)).toBeUndefined();
    expect(defaultClaudeToolType(null)).toBeNull();
  });
});

describe("handleChatCore: Claude-format dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({
      response: new Response(
        JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
      url: "https://api.anthropic.com/v1/messages",
      headers: {},
      transformedBody: null,
    });
  });

  const run = (tools) =>
    handleChatCore({
      body: {
        model: "claude-sonnet-4-5",
        stream: false,
        max_tokens: 64,
        messages: [{ role: "user", content: "hi" }],
        tools,
      },
      modelInfo: { provider: "claude", model: "claude-sonnet-4-5" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), line: vi.fn() },
      connectionId: "test-conn",
      clientRawRequest: {
        endpoint: "/v1/messages",
        body: {},
        headers: { accept: "application/json" },
      },
    });

  it("stamps type:custom on a type-less tool before dispatch", async () => {
    await run([{ name: "echo", description: "", input_schema: { type: "object" } }]);
    const sent = executeMock.mock.calls[0][0].body;
    expect(sent.tools[0].type).toBe("custom");
    expect(sent.tools[0].name).toBe("echo");
  });

  it("does not rewrite a tool that already declares a type", async () => {
    await run([
      { name: "echo", input_schema: { type: "object" } },
      { name: "str_replace", type: "text_editor_20250124" },
    ]);
    const sent = executeMock.mock.calls[0][0].body;
    expect(sent.tools.map((t) => t.type)).toEqual(["custom", "text_editor_20250124"]);
  });
});
