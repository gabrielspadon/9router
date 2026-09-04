// MAX_COMPRESS_BODY_BYTES gate: open-sse/rtk/headroom.js compressWithHeadroom
// skips compression when the WHOLE request body serializes past 256 KiB
// (`sizeSnapshot.bodyBytes > MAX_COMPRESS_BODY_BYTES`, 262144 bytes). Bodies
// are built by padding a tool result; jsonBytes == byte length of
// JSON.stringify, so padding chars are solved arithmetically.

import { describe, it, expect, vi, afterEach } from "vitest";
import { compressWithHeadroom } from "../../open-sse/rtk/headroom.js";

const PROXY = "http://127.0.0.1:8787";
const LIMIT = 256 * 1024; // MAX_COMPRESS_BODY_BYTES

function bodyAtBytes(target) {
  const body = { model: "m", messages: [{ role: "user", content: "" }] };
  const base = new TextEncoder().encode(JSON.stringify(body)).length;
  const pad = target - base; // 'x' is 1 byte/char and never escapes
  if (pad < 1) throw new Error("target too small");
  body.messages[0].content = "x".repeat(pad);
  const check = new TextEncoder().encode(JSON.stringify(body)).length;
  if (check !== target) throw new Error(`padding off: ${check} != ${target}`);
  return body;
}

function okRes(messages) {
  return new Response(
    JSON.stringify({ messages, tokens_before: 100000, tokens_after: 5000, tokens_saved: 95000 }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MAX_COMPRESS_BODY_BYTES size gate", () => {
  it("body at LIMIT-1 compresses", async () => {
    const body = bodyAtBytes(LIMIT - 1);
    const fetchMock = vi.fn(async () =>
      okRes([{ role: "user", content: "ok" }]),
    );
    global.fetch = fetchMock;
    const diagnostics = {};
    const result = await compressWithHeadroom(body, {
      enabled: true, url: PROXY, model: "m", format: "openai", diagnostics,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(body.messages[0].content).toBe("ok");
  });

  it("body exactly at LIMIT compresses (gate is strictly-greater)", async () => {
    const body = bodyAtBytes(LIMIT);
    const fetchMock = vi.fn(async () =>
      okRes([{ role: "user", content: "ok" }]),
    );
    global.fetch = fetchMock;
    const result = await compressWithHeadroom(body, {
      enabled: true, url: PROXY, model: "m", format: "openai", diagnostics: {},
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(body.messages[0].content).toBe("ok");
  });

  it("body at LIMIT+1 skips: no fetch, body untouched, diagnostic names the limit", async () => {
    const body = bodyAtBytes(LIMIT + 1);
    const original = JSON.parse(JSON.stringify(body));
    const fetchMock = vi.fn(async () => {
      throw new Error("fetch must not be called");
    });
    global.fetch = fetchMock;
    const diagnostics = {};
    const result = await compressWithHeadroom(body, {
      enabled: true, url: PROXY, model: "m", format: "openai", diagnostics,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
    expect(body).toEqual(original);
    expect(JSON.stringify(diagnostics)).toContain("payload too large");
    expect(JSON.stringify(diagnostics)).toContain(String(LIMIT));
  });

  it("measurement includes the whole body, not just messages", async () => {
    // A body whose messages are tiny but whose OTHER fields push it past the
    // limit must still skip — the gate reads captureSizeSnapshot(body).
    const pad = LIMIT; // oversized system field alone
    const body = {
      model: "m",
      system: "s".repeat(pad),
      messages: [{ role: "user", content: "hi" }],
    };
    const fetchMock = vi.fn(async () => {
      throw new Error("fetch must not be called");
    });
    global.fetch = fetchMock;
    const result = await compressWithHeadroom(body, {
      enabled: true, url: PROXY, model: "m", format: "claude", diagnostics: {},
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
