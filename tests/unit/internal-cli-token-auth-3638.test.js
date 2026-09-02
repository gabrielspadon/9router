import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  getConsistentMachineId: vi.fn(),
  validateApiKey: vi.fn(),
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

describe("internal model-test authorization (#3638)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TOKENPROXY_PEER_TOKEN = "peer-token-fixture";
    mocks.getConsistentMachineId.mockResolvedValue("internal-cli-token");
    mocks.validateApiKey.mockResolvedValue(false);
  });

  afterEach(() => {
    delete process.env.TOKENPROXY_PEER_TOKEN;
  });

  it.each([
    "http://localhost:20128/api/v1/chat/completions",
    "http://127.0.0.1:20128/api/v1/embeddings",
    "http://[::1]:20128/api/v1/images/generations",
  ])("accepts the generated token only over loopback (%s)", async (url) => {
    const { isInternalModelTestAuthorized } = await import("../../src/lib/auth/internalCliToken.js");

    await expect(isInternalModelTestAuthorized(
      new Request(url, {
        headers: {
          "x-tp-cli-token": "internal-cli-token",
          "x-tp-peer-token": "peer-token-fixture",
          "x-tp-real-ip": "127.0.0.1",
        },
      }),
      null,
      mocks.validateApiKey,
    )).resolves.toBe(true);
  });

  it.each([
    ["missing server peer proof", {}],
    ["wrong server peer proof", { "x-tp-peer-token": "guessed-token", "x-tp-real-ip": "127.0.0.1" }],
    ["stamped public peer", { "x-tp-peer-token": "peer-token-fixture", "x-tp-real-ip": "203.0.113.9" }],
    ["reverse-proxy loopback hop", { "x-tp-peer-token": "peer-token-fixture", "x-tp-real-ip": "127.0.0.1", "x-tp-via-proxy": "1" }],
  ])("rejects a forgeable loopback URL with %s", async (_name, peerHeaders) => {
    const { isInternalModelTestAuthorized } = await import("../../src/lib/auth/internalCliToken.js");

    await expect(isInternalModelTestAuthorized(
      new Request("http://127.0.0.1:20128/api/v1/chat/completions", {
        headers: { "x-tp-cli-token": "internal-cli-token", ...peerHeaders },
      }),
      null,
      mocks.validateApiKey,
    )).resolves.toBe(false);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("rejects a valid token when the request URL is not loopback", async () => {
    const { isInternalModelTestAuthorized } = await import("../../src/lib/auth/internalCliToken.js");

    await expect(isInternalModelTestAuthorized(
      new Request("https://router.example/api/v1/chat/completions", {
        headers: { "x-tp-cli-token": "internal-cli-token" },
      }),
      null,
      mocks.validateApiKey,
    )).resolves.toBe(false);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("rejects missing and forged loopback tokens but preserves valid API-key access", async () => {
    const { isInternalModelTestAuthorized } = await import("../../src/lib/auth/internalCliToken.js");

    await expect(isInternalModelTestAuthorized(
      new Request("http://127.0.0.1:20128/api/v1/audio/transcriptions"),
      null,
      mocks.validateApiKey,
    )).resolves.toBe(false);
    await expect(isInternalModelTestAuthorized(
      new Request("http://127.0.0.1:20128/api/v1/audio/transcriptions", {
        headers: { "x-tp-cli-token": "forged" },
      }),
      null,
      mocks.validateApiKey,
    )).resolves.toBe(false);

    mocks.validateApiKey.mockResolvedValueOnce(true);
    await expect(isInternalModelTestAuthorized(
      new Request("https://router.example/api/v1/chat/completions"),
      "sk-valid",
      mocks.validateApiKey,
    )).resolves.toBe(true);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it.each([
    "../../src/sse/handlers/chat.js",
    "../../src/sse/handlers/embeddings.js",
    "../../src/sse/handlers/imageGeneration.js",
    "../../src/sse/handlers/stt.js",
  ])("routes the required-key gate through loopback internal authorization (%s)", (relativePath) => {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    expect(source).toContain("isInternalModelTestAuthorized(request, apiKey, isValidApiKey)");
  });
});
