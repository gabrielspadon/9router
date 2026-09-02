import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const { executeMock, nonStreamingMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  nonStreamingMock: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    noAuth: true,
    execute: executeMock,
  }),
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

vi.mock("../../open-sse/handlers/chatCore/nonStreamingHandler.js", () => ({
  handleNonStreamingResponse: nonStreamingMock,
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

async function runClaudeRequest({ body: bodyOverrides = {}, native = false } = {}) {
  const body = {
    model: "claude-opus-4-6",
    max_tokens: 256,
    messages: [{ role: "user", content: "hello" }],
    stream: false,
    ...bodyOverrides,
  };
  await handleChatCore({
    body,
    modelInfo: {
      provider: native ? "claude" : "github",
      model: "claude-opus-4-6",
    },
    credentials: { accessToken: "test-token", providerSpecificData: {} },
    connectionId: "thinking-config-test",
    providerThinking: { mode: "high" },
    rtkEnabled: false,
    headroomEnabled: false,
    cavemanEnabled: false,
    ponytailEnabled: false,
    pxpipeEnabled: false,
    sourceFormatOverride: "claude",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    clientRawRequest: {
      endpoint: "/v1/messages",
      body,
      headers: {
        accept: "application/json",
        ...(native ? { "user-agent": "claude-cli/2.1.0" } : {}),
      },
    },
  });
  return executeMock.mock.calls.at(-1)[0].body;
}

beforeEach(() => {
  vi.clearAllMocks();
  executeMock.mockResolvedValue({
    response: new Response("{}", { status: 200 }),
    url: "https://upstream.test/chat/completions",
    headers: {},
    transformedBody: null,
  });
  nonStreamingMock.mockResolvedValue({
    success: true,
    response: new Response("{}", { status: 200 }),
  });
});

describe("PR #2927 provider thinking precedence", () => {
  it("uses a configured level for unlevelled Claude thinking on a translated route", async () => {
    const outbound = await runClaudeRequest({
      body: { thinking: { type: "enabled" } },
    });

    expect(outbound.thinking).toEqual({ type: "adaptive" });
    expect(outbound.output_config).toEqual({ effort: "high" });
  });

  it("replaces an unlevelled adaptive effort marker on a translated route", async () => {
    const outbound = await runClaudeRequest({
      body: {
        thinking: { type: "adaptive" },
        output_config: { effort: "auto" },
      },
    });

    expect(outbound.thinking).toEqual({ type: "adaptive" });
    expect(outbound.output_config).toEqual({ effort: "high" });
  });

  it("does not inject provider thinking into native Claude passthrough", async () => {
    const outbound = await runClaudeRequest({
      native: true,
      body: { thinking: { type: "enabled" } },
    });

    expect(outbound.thinking).toEqual({ type: "enabled" });
    expect(outbound.reasoning_effort).toBeUndefined();
  });

  it("keeps an explicit client level ahead of the provider default", async () => {
    const outbound = await runClaudeRequest({
      body: {
        thinking: { type: "enabled" },
        reasoning_effort: "low",
      },
    });

    expect(outbound.output_config).toEqual({ effort: "low" });
  });

  it("keeps a client thinking budget ahead of the provider default", async () => {
    const outbound = await runClaudeRequest({
      body: { thinking: { type: "enabled", budget_tokens: 1024 } },
    });

    expect(outbound.output_config?.effort).not.toBe("high");
  });

  it("keeps disabled client thinking ahead of the provider default", async () => {
    const outbound = await runClaudeRequest({
      body: { thinking: { type: "disabled" } },
    });

    expect(outbound.thinking).toEqual({ type: "disabled" });
    expect(outbound.output_config).toBeUndefined();
  });
});
