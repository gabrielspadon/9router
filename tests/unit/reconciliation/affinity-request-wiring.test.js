import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// E1.1 G4 / E1.1w W4, the WIRING half.
//
// scheduler-wiring.test.js already proves that getProviderCredentials derives a
// per-session pin WHEN IT IS GIVEN client evidence, and it hands that evidence
// in itself through a `clientOptions()` helper. Nothing proved that a real
// request ever supplies it, and no production caller did: every call reached
// the junction with `options.clientHeaders` and `options.clientBody` undefined,
// so resolveRoutingSessionHash (src/sse/services/auth.js:95-119) hashed the
// literal string "anonymous" and every session of a provider shared one pin.
//
// That is the gate shape this file closes: the unit under test passed while the
// integration was absent. The assertions below are on what the CHAT HANDLER
// hands the selection junction, because that is the seam that was empty.
//
// Free by construction: handleChatCore is mocked, so nothing reaches a provider
// and no completion is spent.

const authMocks = vi.hoisted(() => ({
  clearAccountError: vi.fn(),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
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
  clearAccountError: authMocks.clearAccountError,
  extractApiKey: () => null,
  getProviderCredentials: authMocks.getProviderCredentials,
  isValidApiKey: vi.fn(async () => true),
  markAccountUnavailable: authMocks.markAccountUnavailable,
}));
vi.mock("open-sse/handlers/chatCore.js", () => dispatchMocks);
vi.mock("open-sse/services/combo.js", async (importOriginal) => ({
  ...(await importOriginal()),
  detectRequiredCapabilities: vi.fn(() => []),
  handleComboChat: vi.fn(),
  handleFusionChat: vi.fn(),
}));
vi.mock("@/sse/services/model.js", async (importOriginal) => ({
  ...(await importOriginal()),
  ...modelMocks,
}));
vi.mock("@/lib/localDb", () => settingsMocks);
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, creds) => creds),
  updateProviderCredentials: vi.fn(),
}));
vi.mock("@/sse/utils/logger.js", () => logMocks);

let handleChat;

// SYNTHETIC values. Neither is read from the environment and the bearer below
// is an obviously fake constant, never a real one.
const SESSION_ONE = "session-aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const SESSION_TWO = "session-bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const FAKE_BEARER = "sk-test-0000000000000000000000000000";

function request({ sessionId = null, extraHeaders = {} } = {}) {
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  if (sessionId) headers["x-session-id"] = sessionId;
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "codex/gpt-5.6-sol",
      messages: [{ role: "user", content: "hello" }],
    }),
  });
}

// The options object the chat handler handed the selection junction.
function optionsPassedToSelection(callIndex = 0) {
  return authMocks.getProviderCredentials.mock.calls[callIndex][3];
}

beforeAll(async () => {
  ({ handleChat } = await import("../../../src/sse/handlers/chat.js"));
});

beforeEach(() => {
  vi.clearAllMocks();
  settingsMocks.getSettings.mockResolvedValue({
    requireApiKey: false,
    providerThinking: {},
    providerStrategies: {},
  });
  modelMocks.getComboModels.mockResolvedValue(null);
  modelMocks.getModelInfo.mockResolvedValue({ provider: "codex", model: "gpt-5.6-sol" });
  authMocks.getProviderCredentials.mockResolvedValue({
    connectionId: "account-a",
    connectionName: "account-a",
    apiKey: "provider-key",
    providerSpecificData: {},
  });
  authMocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false, cooldownMs: 0 });
  dispatchMocks.handleChatCore.mockImplementation(() => ({
    success: true,
    response: Response.json({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
  }));
});

describe("E1.1 G4 / E1.1w W4: the chat handler supplies the session evidence selection hashes", () => {
  it("passes the client session header through to the selection junction", async () => {
    const response = await handleChat(request({ sessionId: SESSION_ONE }));
    expect(response.status).toBe(200);

    const options = optionsPassedToSelection();
    // The header sessionManager reads (SESSION_HEADER_KEYS) must ARRIVE. Before
    // this wiring the field was undefined and the pin key was "anonymous".
    expect(options?.clientHeaders?.["x-session-id"]).toBe(SESSION_ONE);
  });

  it("hands headers as a PLAIN object, not a Headers instance", async () => {
    await handleChat(request({ sessionId: SESSION_ONE }));

    const headers = optionsPassedToSelection()?.clientHeaders;
    // sessionManager's headerValue does headers[key]. A Headers instance
    // indexes to undefined and reads as "no session evidence" WITHOUT
    // throwing, so the shape is load-bearing, not incidental.
    expect(headers).not.toBeInstanceOf(Headers);
    expect(typeof headers).toBe("object");
    expect(headers["x-session-id"]).toBe(SESSION_ONE);
  });

  it("passes the parsed body so a body-carried session key still resolves", async () => {
    await handleChat(request({ sessionId: SESSION_ONE }));

    // sessionManager falls back to prompt_cache_key / session_id / the
    // assistant-text digest when no header names the session, and it needs the
    // body to do any of it.
    const body = optionsPassedToSelection()?.clientBody;
    expect(Array.isArray(body?.messages)).toBe(true);
    expect(body.model).toBe("codex/gpt-5.6-sol");
  });

  it("gives two different client sessions two DIFFERENT evidence payloads", async () => {
    await handleChat(request({ sessionId: SESSION_ONE }));
    await handleChat(request({ sessionId: SESSION_TWO }));

    const first = optionsPassedToSelection(0)?.clientHeaders?.["x-session-id"];
    const second = optionsPassedToSelection(1)?.clientHeaders?.["x-session-id"];
    expect(first).toBe(SESSION_ONE);
    expect(second).toBe(SESSION_TWO);
    // The whole point: distinguishable at the junction, so the two hash apart.
    expect(first).not.toBe(second);
  });

  it("never carries a client credential header into the hash input (rule 8)", async () => {
    await handleChat(
      request({
        sessionId: SESSION_ONE,
        extraHeaders: { authorization: `Bearer ${FAKE_BEARER}`, "x-api-key": FAKE_BEARER },
      })
    );

    // withoutClientCredentialHeaders runs BEFORE this object is handed over.
    // Serialize the whole payload rather than checking known key names, so a
    // header added upstream later cannot smuggle a secret through.
    const serialized = JSON.stringify(optionsPassedToSelection()?.clientHeaders ?? {});
    expect(serialized).not.toContain(FAKE_BEARER);
    expect(JSON.parse(serialized)["x-session-id"]).toBe(SESSION_ONE);
  });
});
