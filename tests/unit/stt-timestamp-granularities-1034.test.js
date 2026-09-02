import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleSttCore } from "open-sse/handlers/sttCore.js";

const realFetch = global.fetch;
let sent = null;

beforeEach(() => {
  sent = null;
  global.fetch = vi.fn(async (_url, init) => {
    sent = init.body;
    return new Response(JSON.stringify({ text: "ok" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  });
});
afterEach(() => { global.fetch = realFetch; });

const STT_CONFIG = { baseUrl: "https://example.test/v1/audio/transcriptions", authType: "bearer" };

function request(extra) {
  const fd = new FormData();
  fd.append("file", new File([new Uint8Array([1, 2, 3])], "a.wav", { type: "audio/wav" }));
  for (const [k, v] of extra) fd.append(k, v);
  return handleSttCore({
    provider: "whisper-test", model: "whisper-1", formData: fd,
    credentials: { apiKey: "sk-x" }, sttConfig: STT_CONFIG,
  });
}

const forwarded = (key) => sent.getAll(key);

// timestamp_granularities was in neither the forwarded-field list nor anywhere
// else, so word-level timestamps could not be requested through the gateway
// however the client spelled it (#1034).
describe("STT forwards timestamp_granularities (#1034)", () => {
  it("forwards every value of the repeated bracketed field", async () => {
    await request([
      ["response_format", "verbose_json"],
      ["timestamp_granularities[]", "word"],
      ["timestamp_granularities[]", "segment"],
    ]);
    expect(forwarded("timestamp_granularities[]")).toEqual(["word", "segment"]);
    expect(sent.get("response_format")).toBe("verbose_json");
  });

  it("accepts the bracketless spelling and normalises it", async () => {
    await request([["timestamp_granularities", "word"]]);
    expect(forwarded("timestamp_granularities[]")).toEqual(["word"]);
  });

  it("does not duplicate when a client sends both spellings", async () => {
    await request([
      ["timestamp_granularities[]", "word"],
      ["timestamp_granularities", "word"],
    ]);
    expect(forwarded("timestamp_granularities[]")).toEqual(["word"]);
  });

  it("sends nothing when the client asks for nothing", async () => {
    await request([["language", "en"]]);
    expect(forwarded("timestamp_granularities[]")).toEqual([]);
    expect(sent.get("language")).toBe("en");
  });

  it("the previously forwarded fields are unchanged", async () => {
    await request([["language", "en"], ["prompt", "hi"], ["temperature", "0"]]);
    expect(sent.get("model")).toBe("whisper-1");
    expect(sent.get("language")).toBe("en");
    expect(sent.get("prompt")).toBe("hi");
    expect(sent.get("temperature")).toBe("0");
  });
});
