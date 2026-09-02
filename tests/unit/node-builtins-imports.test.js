import { describe, expect, it } from "vitest";

const RUNTIME_IMPORTS = [
  () => import("../../open-sse/executors/cursor.js"),
  () => import("../../open-sse/handlers/imageGenerationCore.js"),
  () => import("../../open-sse/utils/cursorProtobuf.js"),
  () => import("../../open-sse/utils/proxyFetch.js"),
];

describe("Node built-in imports", () => {
  it("loads every edited runtime module through the Node test runtime", async () => {
    const [cursor, imageGenerationCore, cursorProtobuf, proxyFetch] = await Promise.all(
      RUNTIME_IMPORTS.map((load) => load()),
    );

    expect(cursor.CursorExecutor).toBeTypeOf("function");
    expect(imageGenerationCore.handleImageGenerationCore).toBeTypeOf("function");
    expect(cursorProtobuf.wrapConnectRPCFrame).toBeTypeOf("function");
    expect(proxyFetch.proxyAwareFetch).toBeTypeOf("function");
  });
});
