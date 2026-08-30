import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ proxyAwareFetch: vi.fn() }));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

const { AntigravityExecutor } = await import("../../open-sse/executors/antigravity.js");

describe("Antigravity diagnostic sinks", () => {
  it("does not retain an opaque parsed upstream diagnostic", () => {
    const opaque = "opaque-executor-parse-secret";
    const executor = new AntigravityExecutor();
    const parsed = executor.parseError({ status: 500 }, JSON.stringify({ error: { message: opaque } }));

    expect(parsed.message).toBe("Antigravity upstream request failed");
    expect(JSON.stringify(parsed)).not.toContain(opaque);
  });

  it("does not log an opaque credential-refresh diagnostic", async () => {
    const opaque = "opaque-executor-refresh-secret";
    mocks.proxyAwareFetch.mockRejectedValueOnce(new Error(opaque));
    const log = { error: vi.fn(), info: vi.fn() };
    const executor = new AntigravityExecutor();

    await expect(executor.refreshCredentials({ refreshToken: "refresh-token" }, log)).resolves.toBeNull();
    expect(log.error).toHaveBeenCalledWith("TOKEN", "Antigravity upstream request failed");
    expect(JSON.stringify(log.error.mock.calls)).not.toContain(opaque);
  });
});
