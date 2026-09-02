import { describe, expect, it } from "vitest";

import { handleStreamingResponse } from "open-sse/handlers/chatCore/streamingHandler.js";
import { FORMATS } from "open-sse/translator/formats.js";

const encoder = new TextEncoder();

function toolUseStart(toolName) {
  return {
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", id: "toolu_01", name: toolName, input: {} },
  };
}

function sseResponse(frames) {
  const response = {
    status: 200,
    headers: new Headers({ "content-type": "text/event-stream" }),
    body: new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(encoder.encode(frame));
        controller.close();
      },
    }),
  };
  return response;
}

async function runPassthrough({
  sourceFormat = FORMATS.CLAUDE,
  toolName = "weather_cc",
  toolNameMap,
  terminalToolUse = false,
}) {
  const providerResponse = sseResponse(terminalToolUse
    ? ["event: content_block_start\n", `data: ${JSON.stringify(toolUseStart(toolName))}`]
    : [
      "event: content_block_start\n",
      `data: ${JSON.stringify(toolUseStart(toolName))}\n\n`,
      "event: content_block_delta\n",
      `data: ${JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"city":"Halifax"}' },
      })}\n\n`,
      "event: message_stop\n",
      'data: {"type":"message_stop"}\n\n',
    ]);

  const result = await handleStreamingResponse({
    providerResponse,
    provider: "anthropic",
    model: "claude-test",
    sourceFormat,
    targetFormat: sourceFormat,
    userAgent: "test-agent",
    body: { stream: true, model: "claude-test" },
    translatedBody: {},
    finalBody: {},
    requestStartTime: Date.now(),
    connectionId: "conn-claude-passthrough",
    apiKey: "test-key",
    clientRawRequest: null,
    onRequestSuccess() {},
    reqLogger: { appendProviderChunk() {}, appendConvertedChunk() {} },
    toolNameMap,
    customToolNames: null,
    streamController: {
      signal: new AbortController().signal,
      isConnected: () => true,
      handleComplete() {},
      handleError() {},
      handleDisconnect() {},
      abort() {},
    },
    onStreamComplete() {},
    streamDetailId: "detail-claude-passthrough",
    pxpipe: null,
    reqTag: "CLAUDE_PASSTHROUGH",
    log: { debug() {}, info() {}, warn() {}, errorLine() {}, line() {} },
  });

  expect(result.success).toBe(true);
  return result.response.text();
}

describe("Claude passthrough tool-name decloaking (#2392)", () => {
  it("restores a cloaked tool name in native Claude tool_use start events", async () => {
    const output = await runPassthrough({
      toolNameMap: new Map([["weather_cc", "weather"]]),
    });

    expect(output).toContain('event: content_block_start\n');
    expect(output).toContain('"name":"weather"');
    expect(output).not.toContain('"name":"weather_cc"');
    expect(output).toContain('event: content_block_delta\n');
    expect(output).toContain('"partial_json":"{\\"city\\":\\"Halifax\\"}"');
    expect(output).toContain('event: message_stop\n');
    expect(output.indexOf("event: content_block_start")).toBeLessThan(output.indexOf("event: content_block_delta"));
    expect(output.indexOf("event: content_block_delta")).toBeLessThan(output.indexOf("event: message_stop"));
  });

  it("leaves Claude tool names outside the cloaking map untouched", async () => {
    const output = await runPassthrough({
      toolName: "Bash",
      toolNameMap: new Map([["weather_cc", "weather"]]),
    });

    expect(output).toContain('"name":"Bash"');
  });

  it("decloaks a mapped final unterminated Claude tool_use frame", async () => {
    const output = await runPassthrough({
      toolNameMap: new Map([["weather_cc", "weather"]]),
      terminalToolUse: true,
    });

    expect(output).toContain(
      `event: content_block_start\ndata: ${JSON.stringify(toolUseStart("weather"))}\n`,
    );
    expect(output).not.toContain('"name":"weather_cc"');
  });

  it("keeps a native suffix-like name in a final Claude tool_use frame", async () => {
    const output = await runPassthrough({
      toolName: "analyze_ide",
      toolNameMap: new Map([["weather_cc", "weather"]]),
      terminalToolUse: true,
    });

    expect(output).toContain('"name":"analyze_ide"');
    expect(output.endsWith("\n")).toBe(true);
  });

  it("does not apply a Claude name map to a final non-Claude passthrough", async () => {
    const output = await runPassthrough({
      sourceFormat: FORMATS.OPENAI,
      toolNameMap: new Map([["weather_cc", "weather"]]),
      terminalToolUse: true,
    });

    expect(output).toContain(`data: ${JSON.stringify(toolUseStart("weather_cc"))}\n`);
    expect(output).not.toContain('"name":"weather"');
  });

  it("does not apply a Claude name map to a non-Claude passthrough", async () => {
    const output = await runPassthrough({
      sourceFormat: FORMATS.OPENAI,
      toolNameMap: new Map([["weather_cc", "weather"]]),
    });

    expect(output).toContain('"name":"weather_cc"');
  });
});
