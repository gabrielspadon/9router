import { beforeEach, describe, expect, it, vi } from "vitest";

const { proxyAwareFetch, getConsistentMachineId } = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
  getConsistentMachineId: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));
vi.mock("../../open-sse/shared/machineId.js", () => ({ getConsistentMachineId }));

import { GeminiCLIExecutor } from "../../open-sse/executors/gemini-cli.js";
import { GrokCliExecutor } from "../../open-sse/executors/grok-cli.js";
import { OpenCodeZenExecutor } from "../../open-sse/executors/opencode-zen.js";

const ANONYMOUS_MACHINE_ID = "0123456789abcdef0123456789abcdef";
const ANONYMOUS_AGENT_ID = "01234567-89ab-5def-a123-0123456789ab";

function response() {
  return { status: 200, headers: new Headers() };
}

function grokArgs(credentials) {
  return {
    model: "grok-4.5",
    body: {
      model: "grok-4.5",
      input: [{ type: "message", role: "user", content: "hello" }],
    },
    stream: true,
    credentials,
  };
}

describe("executor request state (#3169)", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
    proxyAwareFetch.mockResolvedValue(response());
    getConsistentMachineId.mockReset();
    getConsistentMachineId.mockResolvedValue(ANONYMOUS_MACHINE_ID);
  });

  it("does not send one Grok connection's device id on the next anonymous request", async () => {
    const executor = new GrokCliExecutor();

    await executor.execute(grokArgs({
      accessToken: "token-a",
      connectionId: "connection-a",
      providerSpecificData: { deviceId: "device-a" },
    }));
    await executor.execute(grokArgs({
      accessToken: "token-b",
      connectionId: "connection-b",
      providerSpecificData: {},
    }));

    const firstHeaders = proxyAwareFetch.mock.calls[0][1].headers;
    const secondHeaders = proxyAwareFetch.mock.calls[1][1].headers;
    expect(firstHeaders["x-grok-agent-id"]).toBe("device-a");
    expect(secondHeaders["x-grok-agent-id"]).toBe(ANONYMOUS_AGENT_ID);
    expect(secondHeaders["x-grok-agent-id"]).not.toBe(firstHeaders["x-grok-agent-id"]);
    expect(secondHeaders.Authorization).toBe("Bearer token-b");
  });

  it("derives Gemini CLI headers from the request model rather than shared executor state", () => {
    const executor = new GeminiCLIExecutor();
    const credentials = { accessToken: "gemini-token" };

    executor.transformRequest("gemini-2.0-flash", { prompt: "one" }, false, credentials);
    executor.transformRequest("gemini-1.5-pro", { prompt: "two" }, false, credentials);

    const flashHeaders = executor.buildHeaders(credentials, false, null, "gemini-2.0-flash");
    const proHeaders = executor.buildHeaders(credentials, false, null, "gemini-1.5-pro");
    expect(flashHeaders["User-Agent"]).toContain("gemini-2.0-flash");
    expect(proHeaders["User-Agent"]).toContain("gemini-1.5-pro");
  });

  it("derives OpenCode Zen authentication from the request model rather than shared executor state", () => {
    const executor = new OpenCodeZenExecutor();
    const credentials = { apiKey: "zen-token" };

    executor.buildUrl("claude-sonnet-4-5");
    executor.buildUrl("gpt-5");

    const claudeHeaders = executor.buildHeaders(credentials, false, null, "claude-sonnet-4-5");
    const chatHeaders = executor.buildHeaders(credentials, false, null, "gpt-5");
    expect(claudeHeaders["x-api-key"]).toBe("zen-token");
    expect(claudeHeaders.Authorization).toBeUndefined();
    expect(chatHeaders.Authorization).toBe("Bearer zen-token");
    expect(chatHeaders["x-api-key"]).toBeUndefined();
  });
});
