import { EventEmitter } from "node:events";
import { describe, it, expect, vi } from "vitest";

const { nativeHttp2Connect } = vi.hoisted(() => ({ nativeHttp2Connect: vi.fn() }));

vi.mock("http2", () => ({ connect: nativeHttp2Connect }));

import { CursorExecutor } from "../../open-sse/executors/cursor.js";
import { encodeField, wrapConnectRPCFrame } from "../../open-sse/utils/cursorProtobuf.js";

const LEN = 2;

function cursorResponseFrame({ text = "", thinking = "" }) {
  const responseFields = [];

  if (text) {
    responseFields.push(encodeField(1, LEN, text));
  }

  if (thinking) {
    const thinkingMessage = encodeField(1, LEN, thinking);
    responseFields.push(encodeField(25, LEN, thinkingMessage));
  }

  const response = Buffer.concat(responseFields.map((field) => Buffer.from(field)));
  const envelope = encodeField(2, LEN, response);
  return Buffer.from(wrapConnectRPCFrame(envelope));
}

function parseSSE(text) {
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => chunk.slice("data: ".length))
    .filter((data) => data !== "[DONE]")
    .map((data) => JSON.parse(data));
}

function fakeAgentSession() {
  const client = new EventEmitter();
  const request = new EventEmitter();
  client.close = vi.fn();
  client.request = vi.fn(() => request);
  request.destroy = vi.fn();
  request.write = vi.fn();
  request.end = vi.fn();
  return { client, request };
}

function terminalAgentFrame(internalReasoning) {
  const update = encodeField(14, LEN, internalReasoning);
  const serverMessage = encodeField(1, LEN, update);
  return Buffer.from(wrapConnectRPCFrame(serverMessage));
}

const agentCredentials = {
  accessToken: "cursor-token",
  providerSpecificData: { machineId: "a".repeat(64) },
};

describe("CursorExecutor Composer thinking-field responses", () => {
  it("does not expose opaque AgentService terminal reasoning in JSON", async () => {
    const native = fakeAgentSession();
    const lease = {
      session: native.client,
      effectiveRoute: { kind: "direct", strictProxy: false, cacheIdentity: "direct" },
      close: vi.fn(() => native.client.close()),
    };
    const connectHttp2 = vi.fn().mockResolvedValue(lease);
    nativeHttp2Connect.mockReturnValue(native.client);
    const pending = new CursorExecutor({ connectHttp2 }).execute({
      model: "gpt-5.3-codex",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: agentCredentials,
      connectTimeout: { globalTimeout: 15000 },
    });

    await vi.waitFor(() => expect(native.client.request).toHaveBeenCalledTimes(1));
    native.request.emit("response", { ":status": 200 });
    native.request.emit("data", terminalAgentFrame("private AgentService reasoning"));
    native.request.emit("end");

    const result = await pending;
    const payload = await result.response.json();
    expect(payload.choices[0].message.content).toBeNull();
    expect(JSON.stringify(payload)).not.toContain("private AgentService reasoning");
    expect(JSON.stringify(payload)).not.toContain("reasoning_content");
  });

  it("does not expose opaque AgentService terminal reasoning in SSE", async () => {
    const native = fakeAgentSession();
    const lease = {
      session: native.client,
      effectiveRoute: { kind: "direct", strictProxy: false, cacheIdentity: "direct" },
      close: vi.fn(() => native.client.close()),
    };
    const connectHttp2 = vi.fn().mockResolvedValue(lease);
    nativeHttp2Connect.mockReturnValue(native.client);
    const pending = new CursorExecutor({ connectHttp2 }).execute({
      model: "gpt-5.3-codex",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials: agentCredentials,
      connectTimeout: { globalTimeout: 15000 },
    });

    await vi.waitFor(() => expect(native.client.request).toHaveBeenCalledTimes(1));
    native.request.emit("response", { ":status": 200 });
    const result = await pending;
    native.request.emit("data", terminalAgentFrame("private AgentService reasoning"));
    native.request.emit("end");

    const events = parseSSE(await result.response.text());
    expect(JSON.stringify(events)).not.toContain("private AgentService reasoning");
    expect(JSON.stringify(events)).not.toContain("reasoning_content");
    expect(events.at(-1).choices[0].finish_reason).toBe("stop");
  });

  it("uses visible content after </think> for non-streaming Composer responses", async () => {
    const executor = new CursorExecutor();
    const buffer = cursorResponseFrame({
      thinking: "private reasoning that must not leak</think>OK",
    });

    const response = executor.transformProtobufToJSON(buffer, "cu/composer-2.5", {
      messages: [{ role: "user", content: "reply OK" }],
    });
    const payload = await response.json();

    expect(payload.choices[0].message.content).toBe("OK");
    expect(JSON.stringify(payload)).not.toContain("private reasoning");
    expect(payload.usage.completion_tokens).toBeGreaterThan(0);
  });

  it("streams only visible content after </think> for Composer responses", async () => {
    const executor = new CursorExecutor();
    const buffer = Buffer.concat([
      cursorResponseFrame({ thinking: "private reasoning" }),
      cursorResponseFrame({ thinking: " that must not leak</think>O" }),
      cursorResponseFrame({ thinking: "K" }),
    ]);

    const response = executor.transformProtobufToSSE(buffer, "composer-2.5-fast", {
      messages: [{ role: "user", content: "reply OK" }],
    });
    const events = parseSSE(await response.text());
    const content = events
      .map((event) => event.choices?.[0]?.delta?.content || "")
      .join("");

    expect(content).toBe("OK");
    expect(JSON.stringify(events)).not.toContain("private reasoning");
    expect(events.at(-1).usage.completion_tokens).toBeGreaterThan(0);
  });

  it("does not treat thinking as visible output for non-Composer models", async () => {
    const executor = new CursorExecutor();
    const buffer = cursorResponseFrame({
      thinking: "private reasoning</think>SHOULD_NOT_APPEAR",
    });

    const response = executor.transformProtobufToJSON(buffer, "gpt-5.3-codex", {
      messages: [{ role: "user", content: "hi" }],
    });
    const payload = await response.json();

    expect(payload.choices[0].message.content).toBeNull();
    expect(JSON.stringify(payload)).not.toContain("SHOULD_NOT_APPEAR");
  });
});
