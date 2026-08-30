import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));

import TraeExecutor from "../../open-sse/executors/trae.js";

function sessionResponse() {
  return new Response(JSON.stringify({
    code: 0,
    data: { chat_session_id: "session-1", message_id: "message-1" },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function hangUntilAbort(calls, safetyMs) {
  return vi.fn((url, init = {}) => {
    calls.push({ url: String(url), signal: init.signal });
    return new Promise((resolve, reject) => {
      const safety = setTimeout(() => reject(new Error("Trae transport exceeded test safety deadline")), safetyMs);
      if (init.signal?.aborted) {
        clearTimeout(safety);
        reject(init.signal.reason);
        return;
      }
      init.signal?.addEventListener("abort", () => {
        clearTimeout(safety);
        reject(init.signal.reason);
      }, { once: true });
    });
  });
}

function abortableEventsResponse(signal, chunks = []) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      if (chunks.length) {
        controller.close();
        return;
      }
      signal?.addEventListener("abort", () => controller.error(signal.reason), { once: true });
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

function args(extra = {}) {
  return {
    model: "claude-sonnet-4.5",
    body: { messages: [{ role: "user", content: "hi" }] },
    stream: true,
    credentials: {
      accessToken: "trae-token",
      providerSpecificData: { bizUserId: "user-1", webId: "web-1" },
    },
    ...extra,
  };
}

function newTraeExecutor() {
  const executor = new TraeExecutor();
  executor.config = { baseUrl: "https://core-normal.trae.ai/api/remote/v1" };
  return executor;
}

async function flush() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

describe("Trae response-header deadlines", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("times out session creation before returning a success wrapper", async () => {
    const calls = [];
    fetchMock.mockImplementation(hangUntilAbort(calls, 8000));
    const pending = newTraeExecutor().execute(args({
      connectTimeout: { providerOverride: 8000, globalTimeout: 15000 },
    }));
    await vi.advanceTimersByTimeAsync(8000);
    const result = await pending;
    expect(result.response.status).toBe(502);
    expect(await result.response.text()).toContain("Upstream response headers exceeded 8000ms");
    expect(calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("streaming returns 200 before an events-header timeout", async () => {
    const calls = [];
    fetchMock.mockResolvedValueOnce(sessionResponse());
    fetchMock.mockImplementationOnce(hangUntilAbort(calls, 15000));
    const result = await newTraeExecutor().execute(args({
      connectTimeout: { globalTimeout: 15000 },
    }));
    expect(result.response.status).toBe(200);
    const bodyAssertion = expect(result.response.text()).rejects.toMatchObject({ name: "ConnectTimeoutError", timeoutMs: 15000 });
    await flush();
    await vi.advanceTimersByTimeAsync(15000);
    await bodyAssertion;
    expect(calls).toHaveLength(1);
    expect(calls[0].signal.reason).toMatchObject({ name: "ConnectTimeoutError", timeoutMs: 15000 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("events headers clear the connect timer and leave only the stream timer", async () => {
    const calls = [];
    fetchMock.mockResolvedValueOnce(sessionResponse());
    fetchMock.mockImplementationOnce(async (url, init) => {
      calls.push({ url: String(url), signal: init.signal });
      return abortableEventsResponse(init.signal);
    });
    const result = await newTraeExecutor().execute(args({ connectTimeout: { globalTimeout: 15000 } }));
    const bodyAssertion = expect(result.response.text()).rejects.toThrow("trae stream timeout");
    await flush();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(15000);
    expect(calls[0].signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(285000);
    await bodyAssertion;
    expect(calls[0].signal.reason).toMatchObject({ message: "trae stream timeout" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("non-streaming waits for events headers and returns a fallback-eligible 502", async () => {
    const calls = [];
    fetchMock.mockResolvedValueOnce(sessionResponse());
    fetchMock.mockImplementationOnce(hangUntilAbort(calls, 15000));
    const pending = newTraeExecutor().execute(args({
      stream: false,
      connectTimeout: { globalTimeout: 15000 },
    }));
    await vi.advanceTimersByTimeAsync(15000);
    const result = await pending;
    expect(result.response.status).toBe(502);
    expect(await result.response.text()).toContain("Upstream response headers exceeded 15000ms");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves caller abort during session creation", async () => {
    const calls = [];
    fetchMock.mockImplementation(hangUntilAbort(calls, 15000));
    const controller = new AbortController();
    const reason = new DOMException("Trae caller left before session", "AbortError");
    const pending = newTraeExecutor().execute(args({
      connectTimeout: { globalTimeout: 15000 },
      signal: controller.signal,
    }));
    await flush();
    expect(calls).toHaveLength(1);
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(calls[0].signal.reason).toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves caller abort while non-stream events wait for headers", async () => {
    const calls = [];
    fetchMock.mockResolvedValueOnce(sessionResponse());
    fetchMock.mockImplementationOnce(hangUntilAbort(calls, 15000));
    const controller = new AbortController();
    const reason = new DOMException("Trae caller left before events", "AbortError");
    const pending = newTraeExecutor().execute(args({
      stream: false,
      connectTimeout: { globalTimeout: 15000 },
      signal: controller.signal,
    }));
    await flush();
    expect(calls).toHaveLength(1);
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(calls[0].signal.reason).toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears both deadlines after a successful non-stream turn", async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse())
      .mockImplementationOnce(async (url, init) => abortableEventsResponse(
        init.signal,
        ["event: plan_item\ndata: {\"id\":\"1\",\"thought\":\"hello\"}\n\nevent: done\ndata: {}\n\n"],
      ));
    const result = await newTraeExecutor().execute(args({
      stream: false,
      connectTimeout: { providerOverride: 8000, globalTimeout: 15000 },
    }));
    expect(result.response.status).toBe(200);
    expect(await result.response.text()).toContain("hello");
    expect(vi.getTimerCount()).toBe(0);
  });
});
