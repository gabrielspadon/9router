import { describe, expect, it, vi } from "vitest";

import { CursorExecutor } from "../../open-sse/executors/cursor.js";

const credentials = {
  accessToken: "cursor-token",
  providerSpecificData: { machineId: "a".repeat(64) },
};

const requestBody = {
  messages: [
    { role: "user", content: "hello" },
    { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "run", arguments: "{}" } }] },
  ],
};

describe("CursorExecutor empty successful transport bodies", () => {
  it.each([
    ["HTTP/2", "makeHttp2Request", null, true],
    ["HTTP/2", "makeHttp2Request", Buffer.alloc(0), false],
    ["proxy-forced fetch", "makeFetchRequest", Buffer.alloc(0), true],
    ["proxy-forced fetch", "makeFetchRequest", Buffer.alloc(0), false],
  ])("returns a bounded 502 for empty %s responses without transforming protobuf", async (_transport, requestMethod, emptyBody, stream) => {
    const executor = new CursorExecutor();
    executor[requestMethod] = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      body: emptyBody,
    });
    executor.transformProtobufToSSE = vi.fn();
    executor.transformProtobufToJSON = vi.fn();

    const result = await executor.execute({
      model: "gpt-5.2",
      body: requestBody,
      stream,
      credentials,
      proxyOptions: requestMethod === "makeFetchRequest" ? { enabled: true } : null,
    });

    expect(result.response.status).toBe(502);
    await expect(result.response.json()).resolves.toEqual({
      error: {
        message: "Cursor returned an empty response body",
        type: "upstream_error",
        code: "missing_response_body",
      },
    });
    expect(executor.transformProtobufToSSE).not.toHaveBeenCalled();
    expect(executor.transformProtobufToJSON).not.toHaveBeenCalled();
  });

  it("continues to transform a non-empty successful HTTP/2 body", async () => {
    const executor = new CursorExecutor();
    const transformed = new Response("ok");
    executor.makeHttp2Request = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      body: Buffer.from([0x00]),
    });
    executor.transformProtobufToSSE = vi.fn().mockReturnValue(transformed);

    const result = await executor.execute({
      model: "gpt-5.2",
      body: requestBody,
      stream: true,
      credentials,
    });

    expect(result.response).toBe(transformed);
    expect(executor.transformProtobufToSSE).toHaveBeenCalledWith(Buffer.from([0x00]), "gpt-5.2", requestBody);
  });
});
