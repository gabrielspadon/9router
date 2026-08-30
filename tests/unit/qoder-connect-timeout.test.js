import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  getQoderModelConfig: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => mocks.fetch(...args),
}));

vi.mock("../../open-sse/services/qoderModels.js", () => ({
  getQoderModelConfig: (...args) => mocks.getQoderModelConfig(...args),
  resolveQoderModels: vi.fn(),
  isQoderPat: vi.fn(() => false),
  resolveQoderCredentials: vi.fn(),
}));

const { QoderExecutor } = await import("../../open-sse/executors/qoder.js");

const credentials = {
  accessToken: "jt-test",
  providerSpecificData: { userId: "user-1", machineId: "machine-1" },
};

function hangUntilAbort(_url, options) {
  return new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mocks.fetch.mockReset();
  mocks.getQoderModelConfig.mockReset();
  mocks.getQoderModelConfig.mockResolvedValue({ key: "auto", source: "system" });
});

afterEach(() => vi.useRealTimers());

describe("QoderExecutor response-header timeout", () => {
  it.each([
    [{ providerOverride: undefined, globalTimeout: 15000 }, 120000],
    [{ providerOverride: 8000, globalTimeout: 15000 }, 8000],
  ])("uses registry before global unless provider overrides", async (connectTimeout, expectedMs) => {
    const executor = new QoderExecutor();
    mocks.fetch.mockImplementation(hangUntilAbort);
    const pending = executor.execute({
      model: "auto",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials,
      connectTimeout,
    });
    const assertion = expect(pending).rejects.toMatchObject({ name: "ConnectTimeoutError", timeoutMs: expectedMs });
    await vi.advanceTimersByTimeAsync(expectedMs);
    await assertion;
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears its deadline when ordinary response headers arrive", async () => {
    const executor = new QoderExecutor();
    mocks.fetch.mockResolvedValueOnce(new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    const result = await executor.execute({
      model: "auto",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials,
      connectTimeout: { providerOverride: 8000, globalTimeout: 15000 },
    });
    expect(result.response.status).toBe(200);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears its deadline and preserves an unrelated network error", async () => {
    const executor = new QoderExecutor();
    const failure = new TypeError("socket closed");
    mocks.fetch.mockRejectedValueOnce(failure);
    await expect(executor.execute({
      model: "auto",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials,
      connectTimeout: { providerOverride: 8000, globalTimeout: 15000 },
    })).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });
});
