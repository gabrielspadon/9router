import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: fetchMock,
}));

import { DevinExecutor } from "../../open-sse/executors/devin.js";
import { GithubExecutor } from "../../open-sse/executors/github.js";
import { VertexExecutor } from "../../open-sse/executors/vertex.js";
import { WindsurfExecutor } from "../../open-sse/executors/windsurf.js";
import ZedExecutor from "../../open-sse/executors/zed.js";

const encoder = new TextEncoder();

function stringField(field, value) {
  const bytes = Buffer.from(value);
  return Buffer.concat([Buffer.from([field << 3 | 2, bytes.length]), bytes]);
}

function hangingFetch(signals) {
  return vi.fn((url, init = {}) => {
    signals.push({ url: String(url), signal: init.signal });
    return new Promise((resolve, reject) => {
      const safetyTimer = setTimeout(
        () => reject(new Error("transport remained pending past the configured deadline")),
        8000,
      );
      if (init.signal?.aborted) {
        clearTimeout(safetyTimer);
        reject(init.signal.reason);
        return;
      }
      init.signal?.addEventListener("abort", () => {
        clearTimeout(safetyTimer);
        reject(init.signal.reason);
      }, { once: true });
    });
  });
}

function okStreamResponse() {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

function directCases() {
  return [
    {
      name: "github responses",
      expectedUrl: "/responses",
      invoke(connectTimeout, signal) {
        const executor = new GithubExecutor();
        executor.knownCodexModels.add("gpt-5.6-codex");
        return executor.execute({
          model: "gpt-5.6-codex",
          body: { messages: [{ role: "user", content: "hi" }] },
          stream: true,
          credentials: { copilotToken: "token" },
          connectTimeout,
          signal,
        });
      },
    },
    {
      name: "github messages",
      expectedUrl: "/messages",
      invoke: (connectTimeout, signal) => new GithubExecutor().execute({
        model: "claude-sonnet-4.5",
        body: { messages: [{ role: "user", content: "hi" }] },
        stream: true,
        credentials: { copilotToken: "token" },
        connectTimeout,
        signal,
      }),
    },
    {
      name: "vertex generation",
      expectedUrl: ":streamGenerateContent",
      invoke: (connectTimeout, signal) => new VertexExecutor("vertex").execute({
        model: "gemini-2.5-pro",
        body: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
        stream: true,
        credentials: { apiKey: "raw-key" },
        connectTimeout,
        signal,
      }),
    },
    {
      name: "windsurf generation",
      expectedUrl: "GetChatMessage",
      invoke: (connectTimeout, signal) => new WindsurfExecutor().execute({
        model: "claude-sonnet-4.5",
        body: { messages: [{ role: "user", content: "hi" }] },
        stream: true,
        credentials: { accessToken: "token" },
        connectTimeout,
        signal,
      }),
    },
  ];
}

function zedCredentials(suffix) {
  return {
    accessToken: `zed-access-${suffix}`,
    providerSpecificData: { userId: `user-${suffix}`, organizationId: `org-${suffix}` },
  };
}

function zedJsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

async function invokeZed({ suffix, connectTimeout, signal }) {
  return new ZedExecutor().execute({
    model: "claude-sonnet-4.5",
    body: { messages: [{ role: "user", content: "hi" }] },
    stream: true,
    credentials: zedCredentials(suffix),
    connectTimeout,
    signal,
  });
}

describe("direct executor response-header deadlines", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(directCases())("$name uses provider override and clears", async (entry) => {
    const calls = [];
    fetchMock.mockImplementation(hangingFetch(calls));

    const pending = entry.invoke({ providerOverride: 8000, globalTimeout: 15000 });
    const assertion = expect(pending).rejects.toMatchObject({
      name: "ConnectTimeoutError",
      timeoutMs: 8000,
    });
    await vi.advanceTimersByTimeAsync(8000);
    await assertion;

    expect(calls.filter(({ url }) => url.includes(entry.expectedUrl))).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(directCases())("$name preserves the exact caller abort", async (entry) => {
    const calls = [];
    fetchMock.mockImplementation(hangingFetch(calls));
    const controller = new AbortController();
    const reason = new DOMException(`${entry.name} caller left`, "AbortError");

    const pending = entry.invoke({ globalTimeout: 15000 }, controller.signal);
    await vi.waitFor(() => {
      expect(calls.some(({ url }) => url.includes(entry.expectedUrl))).toBe(true);
    });
    const generation = calls.find(({ url }) => url.includes(entry.expectedUrl));
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(generation.signal.aborted).toBe(true);
    expect(generation.signal.reason).toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(directCases())("$name clears after success", async (entry) => {
    fetchMock.mockResolvedValue(okStreamResponse());
    const result = await entry.invoke({ providerOverride: 8000, globalTimeout: 15000 });
    expect(result.response.status).toBe(200);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(directCases())("$name clears after unrelated network rejection", async (entry) => {
    const failure = new Error(`${entry.name} network failed`);
    fetchMock.mockRejectedValue(failure);
    await expect(entry.invoke({ providerOverride: 8000, globalTimeout: 15000 })).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("GitHub escalation creates a fresh deadline for /responses", async () => {
    const calls = [];
    fetchMock.mockImplementationOnce(async (url, init) => {
      calls.push({ url: String(url), signal: init.signal });
      return new Response("not accessible via the /chat/completions endpoint", { status: 400 });
    });
    fetchMock.mockImplementationOnce(hangingFetch(calls));

    const executor = new GithubExecutor();
    const pending = executor.execute({
      model: "gpt-5.6-codex-live",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials: { copilotToken: "token" },
      connectTimeout: { providerOverride: 8000, globalTimeout: 15000 },
    });
    const assertion = expect(pending).rejects.toMatchObject({ name: "ConnectTimeoutError", timeoutMs: 8000 });
    await vi.advanceTimersByTimeAsync(8000);
    await assertion;

    const generationCalls = calls.filter(({ url }) => url.includes("/chat/completions") || url.includes("/responses"));
    expect(generationCalls.map(({ url }) => url)).toEqual([
      expect.stringContaining("/chat/completions"),
      expect.stringContaining("/responses"),
    ]);
    expect(generationCalls[0].signal.aborted).toBe(false);
    expect(generationCalls[1].signal.reason).toMatchObject({ name: "ConnectTimeoutError" });
    expect(generationCalls[0].signal).not.toBe(generationCalls[1].signal);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("Devin times only the final chat request", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url: String(url), signal: init.signal });
      if (String(url).includes("GetUserJwt")) {
        return new Response(stringField(1, "user-jwt"), { status: 200 });
      }
      return hangingFetch([])(url, init);
    });

    const pending = new DevinExecutor().execute({
      fetchImpl,
      model: "swe-1-7",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials: { accessToken: "token" },
      connectTimeout: { providerOverride: 8000, globalTimeout: 15000 },
    });
    const assertion = expect(pending).rejects.toMatchObject({ name: "ConnectTimeoutError", timeoutMs: 8000 });
    await vi.advanceTimersByTimeAsync(8000);
    await assertion;

    expect(calls.map(({ url }) => url)).toEqual([
      expect.stringContaining("GetUserJwt"),
      expect.stringContaining("GetChatMessage"),
    ]);
    expect(calls[0].signal).toBeUndefined();
    expect(calls[1].signal.reason).toMatchObject({ name: "ConnectTimeoutError" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("Devin preserves caller abort on the final chat request", async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init) => {
      calls.push({ url: String(url), signal: init.signal });
      if (String(url).includes("GetUserJwt")) return new Response(stringField(1, "user-jwt"), { status: 200 });
      return hangingFetch([])(url, init);
    });
    const controller = new AbortController();
    const reason = new DOMException("Devin caller left", "AbortError");
    const pending = new DevinExecutor().execute({
      fetchImpl,
      model: "swe-1-7",
      body: { messages: [] },
      stream: true,
      credentials: { accessToken: "token" },
      connectTimeout: { globalTimeout: 15000 },
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(calls[1].signal.reason).toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("Devin clears its deadline on success and unrelated rejection", async () => {
    const auth = new Response(stringField(1, "user-jwt"), { status: 200 });
    const successFetch = vi.fn()
      .mockResolvedValueOnce(auth)
      .mockResolvedValueOnce(okStreamResponse());
    const result = await new DevinExecutor().execute({
      fetchImpl: successFetch,
      model: "swe-1-7",
      body: { messages: [] },
      stream: true,
      credentials: { accessToken: "token" },
      connectTimeout: { globalTimeout: 15000 },
    });
    expect(result.response.status).toBe(200);
    expect(vi.getTimerCount()).toBe(0);

    const failure = new Error("Devin network failed");
    const failureFetch = vi.fn()
      .mockResolvedValueOnce(new Response(stringField(1, "user-jwt"), { status: 200 }))
      .mockRejectedValueOnce(failure);
    await expect(new DevinExecutor().execute({
      fetchImpl: failureFetch,
      model: "swe-1-7",
      body: { messages: [] },
      stream: true,
      credentials: { accessToken: "token" },
      connectTimeout: { globalTimeout: 15000 },
    })).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("Zed times only completions after discovery and token acquisition", async () => {
    const calls = [];
    fetchMock.mockImplementation(async (url, init) => {
      calls.push({ url: String(url), signal: init.signal });
      if (String(url).includes("/client/llm_tokens")) return zedJsonResponse({ token: "llm-token" });
      if (String(url).includes("/models")) return zedJsonResponse({ models: [{ id: "claude-sonnet-4.5", provider: "anthropic" }] });
      return hangingFetch([])(url, init);
    });

    const pending = invokeZed({
      suffix: "timeout",
      connectTimeout: { providerOverride: 8000, globalTimeout: 15000 },
    });
    const assertion = expect(pending).rejects.toMatchObject({ name: "ConnectTimeoutError", timeoutMs: 8000 });
    await vi.advanceTimersByTimeAsync(8000);
    await assertion;

    expect(calls.map(({ url }) => url)).toEqual([
      expect.stringContaining("/client/llm_tokens"),
      expect.stringContaining("/models"),
      expect.stringContaining("/completions"),
    ]);
    expect(calls[0].signal).toBeUndefined();
    expect(calls[1].signal).toBeUndefined();
    expect(calls[2].signal.reason).toMatchObject({ name: "ConnectTimeoutError" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("Zed refresh retry creates a fresh full deadline", async () => {
    const calls = [];
    fetchMock.mockImplementation(async (url, init) => {
      calls.push({ url: String(url), signal: init.signal });
      const matching = calls.filter((call) => call.url.includes(String(url).includes("/completions") ? "/completions" : "/client/llm_tokens"));
      if (String(url).includes("/client/llm_tokens")) return zedJsonResponse({ token: `llm-token-${matching.length}` });
      if (String(url).includes("/models")) return zedJsonResponse({ models: [{ id: "claude-sonnet-4.5", provider: "anthropic" }] });
      if (matching.length === 1) return new Response("expired", { status: 401 });
      return hangingFetch([])(url, init);
    });

    const pending = invokeZed({
      suffix: "retry",
      connectTimeout: { providerOverride: 8000, globalTimeout: 15000 },
    });
    await vi.waitFor(() => expect(calls.filter(({ url }) => url.includes("/completions"))).toHaveLength(2));
    const completions = calls.filter(({ url }) => url.includes("/completions"));
    expect(completions[0].signal.aborted).toBe(false);
    expect(completions[0].signal).not.toBe(completions[1].signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: "ConnectTimeoutError", timeoutMs: 8000 });
    await vi.advanceTimersByTimeAsync(8000);
    await assertion;

    expect(calls.map(({ url }) => url)).toEqual([
      expect.stringContaining("/client/llm_tokens"),
      expect.stringContaining("/models"),
      expect.stringContaining("/completions"),
      expect.stringContaining("/client/llm_tokens"),
      expect.stringContaining("/completions"),
    ]);
    expect(completions[1].signal.reason).toMatchObject({ name: "ConnectTimeoutError" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("Zed preserves caller abort and clears on success or unrelated rejection", async () => {
    const controller = new AbortController();
    const reason = new DOMException("Zed caller left", "AbortError");
    const calls = [];
    fetchMock.mockImplementation(async (url, init) => {
      calls.push({ url: String(url), signal: init.signal });
      if (String(url).includes("/client/llm_tokens")) return zedJsonResponse({ token: "llm-token" });
      if (String(url).includes("/models")) return zedJsonResponse({ models: [{ id: "claude-sonnet-4.5", provider: "anthropic" }] });
      return hangingFetch([])(url, init);
    });
    const pending = invokeZed({ suffix: "abort", connectTimeout: { globalTimeout: 15000 }, signal: controller.signal });
    await vi.waitFor(() => expect(calls.some(({ url }) => url.includes("/completions"))).toBe(true));
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(calls.find(({ url }) => url.includes("/completions")).signal.reason).toBe(reason);
    expect(vi.getTimerCount()).toBe(0);

    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes("/client/llm_tokens")) return zedJsonResponse({ token: "success-token" });
      if (String(url).includes("/models")) return zedJsonResponse({ models: [{ id: "claude-sonnet-4.5", provider: "anthropic" }] });
      return okStreamResponse();
    });
    const result = await invokeZed({ suffix: "success", connectTimeout: { globalTimeout: 15000 } });
    expect(result.response.status).toBe(200);
    expect(vi.getTimerCount()).toBe(0);

    const failure = new Error("Zed network failed");
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes("/client/llm_tokens")) return zedJsonResponse({ token: "failure-token" });
      if (String(url).includes("/models")) return zedJsonResponse({ models: [{ id: "claude-sonnet-4.5", provider: "anthropic" }] });
      throw failure;
    });
    await expect(invokeZed({ suffix: "failure", connectTimeout: { globalTimeout: 15000 } })).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });
});
