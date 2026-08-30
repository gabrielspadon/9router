import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Provider registration starts an unrelated release-discovery timer at import
// time. Keep this unit test isolated from that external GitHub request.
vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({
  getKimchiUserAgent: () => "kimchi/test",
  updateKimchiUserAgent: async () => "kimchi/test",
}));

const dispatchMocks = vi.hoisted(() => ({ handleChatCore: vi.fn() }));
const modelMocks = vi.hoisted(() => ({ getComboModels: vi.fn(), getModelInfo: vi.fn() }));
const settingsMocks = vi.hoisted(() => ({ getSettings: vi.fn() }));
const logMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  maskKey: vi.fn(() => "***"),
  warn: vi.fn(),
}));

vi.mock("@/sse/services/auth.js", () => ({
  clearAccountError: vi.fn(),
  extractApiKey: () => null,
  getProviderCredentials: vi.fn(async () => ({
    connectionId: "account-a",
    connectionName: "account-a",
    providerSpecificData: {},
  })),
  isValidApiKey: vi.fn(async () => true),
  markAccountUnavailable: vi.fn(),
}));
vi.mock("open-sse/handlers/chatCore.js", () => dispatchMocks);
vi.mock("open-sse/services/combo.js", () => ({
  detectRequiredCapabilities: vi.fn(() => []),
  handleComboChat: vi.fn(),
  handleFusionChat: vi.fn(),
}));
vi.mock("@/sse/services/model.js", () => modelMocks);
vi.mock("@/lib/localDb", () => settingsMocks);
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  updateProviderCredentials: vi.fn(),
}));
vi.mock("@/sse/utils/logger.js", () => logMocks);
vi.mock("open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(),
    logConvertedResponse: vi.fn(),
    logError: vi.fn(),
  }),
}));

let handleChat;

function request(body) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
});

beforeEach(() => {
  vi.clearAllMocks();
  settingsMocks.getSettings.mockResolvedValue({
    requireApiKey: false,
    providerThinking: {},
    cavemanEnabled: false,
    ponytailEnabled: false,
    ccFilterNaming: false,
  });
  modelMocks.getComboModels.mockResolvedValue(null);
  modelMocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-4o" });
  dispatchMocks.handleChatCore.mockResolvedValue({
    success: true,
    response: Response.json({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
  });
});

describe("Mistral trailing-assistant normalization (PR 2129)", () => {
  it("leaves a non-Mistral request body byte-for-byte unchanged before dispatch", async () => {
    const body = {
      model: "openai/gpt-4o",
      messages: [
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "partial answer",
          reasoning_content: "provider-owned reasoning",
        },
      ],
    };
    const expectedJson = JSON.stringify(body);

    const response = await handleChat(request(body));

    expect(response.status).toBe(200);
    expect(JSON.stringify(dispatchMocks.handleChatCore.mock.calls[0][0].body)).toBe(expectedJson);
  });

  it("marks the trailing assistant after Claude-to-Mistral translation", () => {
    const claudeBody = {
      max_tokens: 256,
      messages: [
        { role: "user", content: [{ type: "text", text: "hi" }] },
        {
          role: "assistant",
          content: [{ type: "text", text: "partial answer" }],
        },
      ],
    };
    const translated = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.OPENAI,
      "mistral-large-latest",
      claudeBody,
      false,
      null,
      "mistral",
    );

    const outbound = new DefaultExecutor("mistral").transformRequest(
      "mistral-large-latest",
      translated,
      false,
      {},
      FORMATS.CLAUDE,
    );

    expect(outbound.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "partial answer", prefix: true },
    ]);
  });

  it("does not alter a final user turn for Mistral", () => {
    const body = {
      model: "mistral-large-latest",
      messages: [
        { role: "assistant", content: "earlier answer" },
        { role: "user", content: "continue" },
      ],
    };

    const outbound = new DefaultExecutor("mistral").transformRequest(
      "mistral-large-latest",
      body,
      false,
      {},
      FORMATS.OPENAI,
    );

    expect(outbound.messages).toEqual(body.messages);
  });

  it("does not mark a trailing assistant in another default executor", () => {
    const body = {
      model: "some-model",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "partial answer" },
      ],
    };
    const expectedJson = JSON.stringify(body);

    const outbound = new DefaultExecutor("openrouter").transformRequest(
      "some-model",
      body,
      false,
      {},
      FORMATS.OPENAI,
    );

    expect(JSON.stringify(outbound)).toBe(expectedJson);
  });
});
