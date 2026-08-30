import { beforeEach, describe, expect, it, vi } from "vitest";

const { debugMock } = vi.hoisted(() => ({ debugMock: vi.fn() }));

vi.mock("../../open-sse/utils/debugLog.js", () => ({
  dbg: (...args) => debugMock(...args),
}));

const { BaseExecutor } = await import("../../open-sse/executors/base.js");
const { OllamaLocalExecutor } = await import("../../open-sse/executors/ollama-local.js");
const { ConnectTimeoutError } = await import("../../open-sse/utils/responseHeaderTimeout.js");

const request = {
  model: "llama3",
  body: { messages: [{ role: "user", content: "hi" }] },
  stream: true,
  credentials: {},
};

beforeEach(() => {
  debugMock.mockReset();
  vi.restoreAllMocks();
});

describe("OllamaLocalExecutor connect timeout diagnostics", () => {
  it("preserves provider context and reports the effective typed timeout", async () => {
    const failure = new ConnectTimeoutError(8000);
    const execute = vi.spyOn(BaseExecutor.prototype, "execute").mockRejectedValueOnce(failure);
    const executor = new OllamaLocalExecutor();
    const connectTimeout = { providerOverride: 8000, globalTimeout: 15000 };

    await expect(executor.execute({ ...request, connectTimeout })).rejects.toBe(failure);

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ connectTimeout }));
    const output = debugMock.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).toContain("timeout=8.0s");
    expect(output).toContain("within 8.0s");
    expect(output).toContain("adjust the provider or global response-header timeout setting");
    expect(output).not.toContain("timeout=120.0s");
    expect(output).not.toContain("OLLAMA_LOCAL_CONNECT_TIMEOUT_MS");
  });

  it("does not diagnose caller cancellation as a connect timeout", async () => {
    const failure = new DOMException("client left", "AbortError");
    vi.spyOn(BaseExecutor.prototype, "execute").mockRejectedValueOnce(failure);
    const executor = new OllamaLocalExecutor();

    await expect(executor.execute({
      ...request,
      connectTimeout: { providerOverride: 8000, globalTimeout: 15000 },
    })).rejects.toBe(failure);

    const output = debugMock.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(output).not.toContain("diagnosis");
  });
});
