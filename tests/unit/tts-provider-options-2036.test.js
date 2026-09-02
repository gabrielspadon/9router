import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import geminiTts from "open-sse/handlers/ttsProviders/gemini.js";

// The adapter splits model and voice on a slash.
const MODEL = "gemini-2.5-flash-preview-tts/Kore";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const originalFetch = global.fetch;
const AUDIO = {
  candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from("pcm").toString("base64") } }] } }],
};

const sentBody = () => JSON.parse(global.fetch.mock.calls[0][1].body);

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(AUDIO), { status: 200, headers: { "Content-Type": "application/json" } }),
  );
});
afterEach(() => { global.fetch = originalFetch; });

const say = (providerOptions) =>
  geminiTts.synthesize("hello", MODEL, { apiKey: "k" }, "wav", { providerOptions });

describe("a provider's own speech settings survive the normalized body (#2036)", () => {
  it("passes a caller's generation settings through", async () => {
    await say({ generationConfig: { temperature: 0.4, speakingRate: 1.4 } });
    const cfg = sentBody().generationConfig;
    expect(cfg.temperature).toBe(0.4);
    expect(cfg.speakingRate).toBe(1.4);
  });

  it("keeps the settings a caller does not send", async () => {
    await say({});
    const cfg = sentBody().generationConfig;
    expect(cfg.responseModalities).toEqual(["AUDIO"]);
    expect(cfg.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Kore");
  });

  it("a request cannot change the modality that makes this a speech call", async () => {
    await say({ generationConfig: { responseModalities: ["TEXT"] } });
    expect(sentBody().generationConfig.responseModalities).toEqual(["AUDIO"]);
  });

  it("a request cannot change the voice the model id resolved", async () => {
    await say({ generationConfig: { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Someone" } } } } });
    expect(sentBody().generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Kore");
  });

  it("keeps a sibling speech setting the caller did send", async () => {
    await say({ generationConfig: { speechConfig: { languageCode: "vi-VN" } } });
    expect(sentBody().generationConfig.speechConfig.languageCode).toBe("vi-VN");
  });

  it("behaves as before when nothing extra is supplied", async () => {
    await geminiTts.synthesize("hello", MODEL, { apiKey: "k" }, "wav", {});
    expect(sentBody().generationConfig.responseModalities).toEqual(["AUDIO"]);
  });
});

describe("the extras are collected from the request and carried down", () => {
  const handler = read("src/sse/handlers/tts.js");
  const core = read("open-sse/handlers/ttsCore.js");

  it("the fields the router owns are not treated as provider options", () => {
    expect(handler).toContain('["model", "input", "voice", "response_format", "language", "style", "stream"]');
  });

  it("they reach the adapter", () => {
    expect(core).toContain("{ language, style, providerOptions }");
  });
});
