import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { http2Connect, proxyFetch } = vi.hoisted(() => ({
  http2Connect: vi.fn(),
  proxyFetch: vi.fn(),
}));

vi.mock("http2", () => ({ connect: http2Connect }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: proxyFetch }));

import { CursorExecutor } from "../../open-sse/executors/cursor.js";

function fakeHttp2Session(sessions) {
  const client = new EventEmitter();
  const request = new EventEmitter();
  request.write = vi.fn();
  request.end = vi.fn();
  request.destroy = vi.fn();
  client.close = vi.fn();
  client.request = vi.fn(() => request);
  sessions.push({ client, request });
  return client;
}

function hangUntilAbort(calls, safetyMs) {
  return vi.fn((url, init = {}) => {
    calls.push({ url: String(url), signal: init.signal });
    return new Promise((resolve, reject) => {
      const safety = setTimeout(() => reject(new Error("Cursor transport exceeded test safety deadline")), safetyMs);
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

const credentials = {
  accessToken: "cursor-token",
  providerSpecificData: { machineId: "a".repeat(64) },
};

function legacyArgs(extra = {}) {
  return {
    model: "gpt-5.2",
    body: {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "run", arguments: "{}" } }] },
      ],
    },
    stream: false,
    credentials,
    ...extra,
  };
}

function agentArgs(extra = {}) {
  return {
    model: "gpt-5.2",
    body: { messages: [{ role: "user", content: "hi" }] },
    stream: false,
    credentials,
    ...extra,
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("Cursor response-header deadlines", () => {
  const sessions = [];

  beforeEach(() => {
    vi.useFakeTimers();
    sessions.length = 0;
    proxyFetch.mockReset();
    http2Connect.mockReset();
    http2Connect.mockImplementation(() => fakeHttp2Session(sessions));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fetch mode rejects with the provider response-header timeout", async () => {
    const calls = [];
    proxyFetch.mockImplementation(hangUntilAbort(calls, 8000));
    const pending = new CursorExecutor().execute(legacyArgs({
      proxyOptions: { enabled: true },
      connectTimeout: { providerOverride: 8000, globalTimeout: 15000 },
    }));
    const assertion = expect(pending).rejects.toMatchObject({ name: "ConnectTimeoutError", timeoutMs: 8000 });
    await vi.advanceTimersByTimeAsync(8000);
    await assertion;
    expect(calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fetch mode preserves the exact caller abort", async () => {
    const calls = [];
    proxyFetch.mockImplementation(hangUntilAbort(calls, 15000));
    const controller = new AbortController();
    const reason = new DOMException("Cursor fetch caller left", "AbortError");
    const pending = new CursorExecutor().execute(legacyArgs({
      proxyOptions: { enabled: true },
      connectTimeout: { globalTimeout: 15000 },
      signal: controller.signal,
    }));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(calls[0].signal.reason).toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["standard HTTP/2", () => new CursorExecutor().execute(legacyArgs({ connectTimeout: { providerOverride: 8000, globalTimeout: 15000 } }))],
    ["AgentService HTTP/2", () => new CursorExecutor().execute(agentArgs({ connectTimeout: { providerOverride: 8000, globalTimeout: 15000 } }))],
  ])("%s rejects with the provider response-header timeout", async (name, invoke) => {
    const pending = invoke();
    await flush();
    expect(sessions).toHaveLength(1);
    const assertion = expect(pending).rejects.toMatchObject({ name: "ConnectTimeoutError", timeoutMs: 8000 });
    await vi.advanceTimersByTimeAsync(8000);
    await assertion;
    expect(sessions[0].request.destroy).toHaveBeenCalled();
    expect(sessions[0].client.close).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fetch mode clears its deadline before reading the body", async () => {
    let resolveBody;
    proxyFetch.mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        resolveBody = () => {
          controller.enqueue(new Uint8Array());
          controller.close();
        };
      },
    }), { status: 200 }));
    const pending = new CursorExecutor().makeFetchRequest(
      "https://api2.cursor.sh/aiserver.v1.ChatService/StreamUnifiedChatWithTools",
      {},
      new Uint8Array(),
      undefined,
      { enabled: true },
      { globalTimeout: 15000 },
    );
    await flush();
    expect(vi.getTimerCount()).toBe(0);
    resolveBody();
    await expect(pending).resolves.toMatchObject({ status: 200 });
  });

  it("standard HTTP/2 clears only the header deadline and keeps the original whole-request ceiling", async () => {
    const executor = new CursorExecutor();
    const pending = executor.makeHttp2Request(
      "https://api2.cursor.sh/chat",
      {},
      Buffer.from("body"),
      undefined,
      { providerOverride: 8000, globalTimeout: 15000 },
    );
    await vi.advanceTimersByTimeAsync(7999);
    sessions[0].request.emit("response", { ":status": 200 });
    expect(vi.getTimerCount()).toBe(1);
    const assertion = expect(pending).rejects.toThrow("HTTP/2 request timed out");
    await vi.advanceTimersByTimeAsync(52001);
    await assertion;
    expect(sessions[0].request.destroy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("standard HTTP/2 completes before the legacy ceiling with no timers", async () => {
    const pending = new CursorExecutor().makeHttp2Request(
      "https://api2.cursor.sh/chat",
      {},
      Buffer.from("body"),
      undefined,
      { globalTimeout: 15000 },
    );
    sessions[0].request.emit("response", { ":status": 200 });
    sessions[0].request.emit("data", Buffer.from("ok"));
    sessions[0].request.emit("end");
    await expect(pending).resolves.toMatchObject({ status: 200, body: Buffer.from("ok") });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a 120000 override cannot extend Cursor's existing 60000 ceiling", async () => {
    const pending = new CursorExecutor().makeHttp2Request(
      "https://api2.cursor.sh/chat",
      {},
      Buffer.from("body"),
      undefined,
      { providerOverride: 120000, globalTimeout: 15000 },
    );
    const assertion = expect(pending).rejects.toThrow("HTTP/2 request timed out");
    await vi.advanceTimersByTimeAsync(60000);
    await assertion;
    expect(sessions[0].request.destroy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["standard", "agent"])("%s HTTP/2 rejects a pre-aborted caller before opening a client", async (mode) => {
    const controller = new AbortController();
    const reason = new DOMException(`${mode} caller already left`, "AbortError");
    controller.abort(reason);
    const executor = new CursorExecutor();
    const pending = mode === "standard"
      ? executor.makeHttp2Request("https://api2.cursor.sh/chat", {}, Buffer.from("body"), controller.signal, { globalTimeout: 15000 })
      : Promise.resolve().then(() => executor.openAgentHttp2Stream("https://agent.api5.cursor.sh/run", {}, controller.signal, { globalTimeout: 15000 }));
    await expect(pending).rejects.toBe(reason);
    expect(http2Connect).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("standard HTTP/2 preserves caller abort before and after headers", async () => {
    for (const afterHeaders of [false, true]) {
      const controller = new AbortController();
      const reason = new DOMException(`standard caller left ${afterHeaders}`, "AbortError");
      const pending = new CursorExecutor().makeHttp2Request(
        "https://api2.cursor.sh/chat",
        {},
        Buffer.from("body"),
        controller.signal,
        { globalTimeout: 15000 },
      );
      const session = sessions.at(-1);
      if (afterHeaders) session.request.emit("response", { ":status": 200 });
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
      expect(session.request.destroy).toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it("AgentService preserves caller abort after headers", async () => {
    const controller = new AbortController();
    const reason = new DOMException("Agent caller left after headers", "AbortError");
    const session = new CursorExecutor().openAgentHttp2Stream(
      "https://agent.api5.cursor.sh/agent.v1.AgentService/Run",
      {},
      controller.signal,
      { globalTimeout: 15000 },
    );
    sessions[0].request.emit("response", { ":status": 200 });
    await session.responseHeaders;
    controller.abort(reason);
    await expect(session.read()).rejects.toBe(reason);
    expect(sessions[0].request.destroy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("an unrelated HTTP/2 protocol error retains the public 500 response", async () => {
    const pending = new CursorExecutor().execute(legacyArgs({ connectTimeout: { globalTimeout: 15000 } }));
    await flush();
    sessions[0].request.emit("error", new Error("protocol broke"));
    const result = await pending;
    expect(result.response.status).toBe(500);
    expect(await result.response.text()).toContain("protocol broke");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["normal end", "protocol error", "caller abort"])("AgentService removes its full-stream abort listener once on %s", async (ending) => {
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, "addEventListener");
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");
    const session = new CursorExecutor().openAgentHttp2Stream(
      "https://agent.api5.cursor.sh/agent.v1.AgentService/Run",
      {},
      controller.signal,
      { globalTimeout: 15000 },
    );
    const native = sessions[0];
    const callerListener = addSpy.mock.calls.filter(([type]) => type === "abort").at(-1)[1];

    if (ending === "normal end") {
      native.request.emit("response", { ":status": 200 });
      native.request.emit("end");
      await session.responseHeaders;
    } else if (ending === "protocol error") {
      const assertion = expect(session.responseHeaders).rejects.toThrow("agent protocol broke");
      native.request.emit("error", new Error("agent protocol broke"));
      await assertion;
    } else {
      const reason = new DOMException("agent caller left", "AbortError");
      const assertion = expect(session.responseHeaders).rejects.toBe(reason);
      controller.abort(reason);
      await assertion;
    }

    session.close();
    session.close();
    expect(removeSpy.mock.calls.filter(([type, listener]) => type === "abort" && listener === callerListener)).toHaveLength(1);
    expect(native.request.destroy).toHaveBeenCalled();
    expect(native.client.close).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("executeAgent removes its caller forwarding listener on normal completion", async () => {
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, "addEventListener");
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");
    const pending = new CursorExecutor().executeAgent(agentArgs({ signal: controller.signal, connectTimeout: { globalTimeout: 15000 } }));
    await flush();
    sessions[0].request.emit("response", { ":status": 200 });
    sessions[0].request.emit("end");
    await expect(pending).resolves.toMatchObject({ response: expect.any(Response) });
    const forwardingListener = addSpy.mock.calls.find(([type]) => type === "abort")[1];
    expect(removeSpy.mock.calls.filter(([type, listener]) => type === "abort" && listener === forwardingListener)).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
