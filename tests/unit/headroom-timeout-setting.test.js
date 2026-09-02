/**
 * The Headroom compression timeout was reachable only through the
 * HEADROOM_TIMEOUT_MS env var, so an operator on a slow box could not raise it
 * from the dashboard and every busy request timed out at the built-in default,
 * sending the model an inconsistently compressed body and busting prompt cache.
 *
 * headroomTimeoutMs is a persisted setting that outranks the env var; when it is
 * not configured, resolution is exactly what it is today (env, then default).
 *
 * Upstream: 993c6eb46.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeWithDefaults } from "../../src/lib/db/repos/settingsRepo.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

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
const { resetHeadroomCircuitBreaker } = await import("../../open-sse/rtk/headroom.js");

describe("headroomTimeoutMs setting", () => {
  it("is unset by default so the env var and the built-in default still decide", () => {
    expect(mergeWithDefaults({})).toHaveProperty("headroomTimeoutMs", null);
  });

  it("keeps a configured integer inside the accepted window", () => {
    expect(mergeWithDefaults({ headroomTimeoutMs: 45000 }).headroomTimeoutMs).toBe(45000);
    expect(mergeWithDefaults({ headroomTimeoutMs: 1 }).headroomTimeoutMs).toBe(1);
    expect(mergeWithDefaults({ headroomTimeoutMs: 599999 }).headroomTimeoutMs).toBe(599999);
  });

  it("drops a value AbortSignal.timeout would misread back to unset", () => {
    // AbortSignal.timeout coerces NaN/null to 0 and aborts instantly, which
    // would disable compression silently rather than loudly.
    for (const bad of [0, -1, 1.5, NaN, Infinity, "5000", 600000, {}]) {
      expect(mergeWithDefaults({ headroomTimeoutMs: bad }).headroomTimeoutMs, String(bad)).toBeNull();
    }
  });

  it("is preferred over the env fallback by the chat handler", () => {
    const chat = readFileSync(join(root, "src/sse/handlers/chat.js"), "utf8");
    expect(chat).toContain("headroomTimeoutMs: chatSettings.headroomTimeoutMs ?? parseHeadroomTimeoutMs(),");
  });
});

describe("handleChatCore threads the timeout to the compression call", () => {
  let timeouts;

  beforeEach(() => {
    vi.clearAllMocks();
    resetHeadroomCircuitBreaker();
    timeouts = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      timeouts.push(ms);
      return new AbortController().signal;
    });
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("/v1/compress")) {
        return new Response(
          JSON.stringify({
            messages: [{ role: "user", content: "short" }],
            tokens_before: 100,
            tokens_after: 20,
            tokens_saved: 80,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    executeMock.mockResolvedValue({
      response: new Response(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop", index: 0 }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
      url: "https://api.openai.com/v1/chat/completions",
      headers: {},
      transformedBody: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetHeadroomCircuitBreaker();
  });

  const run = (headroomTimeoutMs) =>
    handleChatCore({
      body: { model: "gpt-4o", stream: false, messages: [{ role: "user", content: "hello" }] },
      modelInfo: { provider: "openai", model: "gpt-4o" },
      credentials: { apiKey: "test-key", providerSpecificData: {} },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), line: vi.fn() },
      connectionId: "test-conn",
      headroomEnabled: true,
      headroomUrl: "http://localhost:8787",
      headroomCompressUserMessages: false,
      headroomTimeoutMs,
      rtkEnabled: false,
      cavemanEnabled: false,
      ponytailEnabled: false,
      clientRawRequest: {
        endpoint: "/v1/chat/completions",
        body: {},
        headers: { accept: "application/json" },
      },
    });

  it("uses the configured value", async () => {
    await run(45000);
    expect(timeouts).toContain(45000);
  });

  it("falls back to the built-in default when nothing is configured", async () => {
    await run(undefined);
    expect(timeouts).toContain(15000);
  });
});
