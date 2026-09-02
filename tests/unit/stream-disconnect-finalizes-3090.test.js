import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createStreamController, createDisconnectAwareStream } from "../../open-sse/utils/streamHandler.js";

// A streaming request saves a placeholder requestDetail row immediately and
// updates it from the SSE transform's flush(). A client that disconnects before
// upstream EOF never reaches flush(), so the row stayed at "[Streaming in
// progress...]" with 0/0 tokens forever. Both disconnect routes must reach the
// finalizer instead.
function idleTransform() {
  return new TransformStream();
}

describe("a client disconnect finalizes the request detail row (#3090)", () => {
  it("fires onDisconnect when the stream is cancelled", async () => {
    const seen = [];
    const controller = createStreamController({
      onDisconnect: (r) => seen.push(r?.reason ?? "unknown"),
      onError: () => {}, provider: "p", model: "m",
    });
    const stream = createDisconnectAwareStream(idleTransform(), controller);
    const reader = stream.getReader();
    await reader.cancel("client went away");
    expect(seen).toHaveLength(1);
  });

  it("fires onDisconnect when only the caller signal aborts", async () => {
    // The reported caveat: the host does not always call cancel() on client
    // disconnect. The caller-abort listener must cover that on its own.
    const seen = [];
    const controller = createStreamController({
      onDisconnect: (r) => seen.push(r?.reason ?? "unknown"),
      onError: () => {}, provider: "p", model: "m",
    });
    const ac = new AbortController();
    const stream = createDisconnectAwareStream(idleTransform(), controller, null, { callerSignal: ac.signal });
    stream.getReader();           // start() installs the listener
    ac.abort();
    await Promise.resolve();
    expect(seen).toEqual(["caller_aborted"]);
  });

  it("fires once, not once per route", async () => {
    const seen = [];
    const controller = createStreamController({
      onDisconnect: (r) => seen.push(r?.reason ?? "unknown"),
      onError: () => {}, provider: "p", model: "m",
    });
    const ac = new AbortController();
    const stream = createDisconnectAwareStream(idleTransform(), controller, null, { callerSignal: ac.signal });
    const reader = stream.getReader();
    ac.abort();
    await reader.cancel("also cancelled").catch(() => {});
    expect(seen).toHaveLength(1);
  });

  it("the disconnect handler is wired to the row finalizer", () => {
    // onStreamAbandoned is what writes content + partial tokens and sets
    // status "cancelled"; onDisconnect must call it or the row stays a placeholder.
    const core = readFileSync(new URL("../../open-sse/handlers/chatCore.js", import.meta.url), "utf8");
    const onDisconnect = core.slice(core.indexOf("onDisconnect: (reason) => {"));
    expect(onDisconnect.slice(0, onDisconnect.indexOf("},"))).toContain("abandonStreamingDetail?.(");
    expect(core).toContain("abandonStreamingDetail = onStreamAbandoned;");

    const sh = readFileSync(new URL("../../open-sse/handlers/chatCore/streamingHandler.js", import.meta.url), "utf8");
    const abandoned = sh.slice(sh.indexOf("const onStreamAbandoned"));
    expect(abandoned).toContain('status: "cancelled"');
    expect(abandoned).toContain("saveRequestDetail(");
  });
});
