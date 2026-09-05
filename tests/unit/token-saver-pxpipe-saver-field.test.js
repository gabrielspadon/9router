// pxpipe event shape: the object chatCore hands to onPxpipeEvent must carry
// saver:'pxpipe' on BOTH the applied and fail-open paths, otherwise the
// closed-set tokenSaver events store would drop the row at ingest
// (src/lib/tokenSaver/events.js: SAVERS.has(event.saver)).
import { describe, it, expect, vi, beforeEach } from "vitest";

const chatCoreMocks = vi.hoisted(() => ({
  executeMock: vi.fn(),
  onPxpipeEvent: vi.fn(),
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: chatCoreMocks.executeMock }),
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

import { handleChatCore } from "../../open-sse/handlers/chatCore.js";

const encoder = new TextEncoder();

function makeExecutorRes() {
  return {
    response: new Response(
      JSON.stringify({
        id: "chatcmpl-x",
        object: "chat.completion",
        choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop", index: 0 }],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    ),
    url: "https://api.openai.com/v1/chat/completions",
    headers: {},
    transformedBody: null,
  };
}

function pxpipeArgs(overrides = {}) {
  return {
    body: {
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      stream: false,
      system: "s".repeat(30000),
      messages: [{ role: "user", content: "hi" }],
    },
    modelInfo: { provider: "anthropic", model: "claude-sonnet-4-5" },
    credentials: { apiKey: "k" },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), line: vi.fn(), tagForSession: () => "TAG", nextTag: () => "TAG", fmtThink: () => null },
    connectionId: "conn-1",
    pxpipeEnabled: true,
    pxpipeMinChars: 100,
    pxpipeTimeoutMs: 5000,
    pxpipeTransform: async () => ({
      applied: true,
      body: encoder.encode(JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 1024,
        system: "PNG-IMAGE-PLACEHOLDER",
        messages: [],
      })),
      info: { imageCount: 1, imagePixels: 750 },
    }),
    onPxpipeEvent: chatCoreMocks.onPxpipeEvent,
    ...overrides,
  };
}

describe("pxpipe event payload carries saver:'pxpipe'", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatCoreMocks.executeMock.mockResolvedValue(makeExecutorRes());
  });

  it("applied path: emitted event has saver:'pxpipe'", async () => {
    await handleChatCore(pxpipeArgs());
    const event = chatCoreMocks.onPxpipeEvent.mock.calls.at(-1)?.[0];
    expect(event).toBeTruthy();
    expect(event.saver).toBe("pxpipe");
    expect(event.applied).toBe(true);
  });

  it("fail-open path (transform throws): emitted event still has saver:'pxpipe'", async () => {
    await handleChatCore(pxpipeArgs({
      pxpipeTransform: async () => {
        throw new Error("proxy down");
      },
    }));
    const event = chatCoreMocks.onPxpipeEvent.mock.calls.at(-1)?.[0];
    expect(event).toBeTruthy();
    expect(event.saver).toBe("pxpipe");
    expect(event.applied).toBe(false);
    expect(event.reason).toBe("transform_error");
  });
});
