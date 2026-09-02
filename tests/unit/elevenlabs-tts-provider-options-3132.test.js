import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import elevenlabs from "open-sse/handlers/ttsProviders/elevenlabs.js";

// The adapter splits model and voice on a slash; without one it is a bare voice id.
const MODEL = "eleven_multilingual_v2/Rachel";

const originalFetch = global.fetch;
// synthesize() rejects anything under 1024 bytes as empty audio.
const AUDIO = () => new Response(new Uint8Array(2048), { status: 200 });

const sentBody = () => JSON.parse(global.fetch.mock.calls[0][1].body);

beforeEach(() => { global.fetch = vi.fn().mockResolvedValue(AUDIO()); });
afterEach(() => { global.fetch = originalFetch; });

const say = (providerOptions) =>
  elevenlabs.synthesize("hello", MODEL, { apiKey: "k" }, "mp3", { providerOptions });

describe("ElevenLabs honours caller-supplied provider options (#3132)", () => {
  it("carries a caller's voice_settings and output_format into the request body", async () => {
    await say({ voice_settings: { stability: 0.9, style: 0.3 }, output_format: "mp3_44100_128" });
    const body = sentBody();
    expect(body.voice_settings.stability).toBe(0.9);
    expect(body.voice_settings.style).toBe(0.3);
    // output_format is a query parameter for this vendor, not a body field,
    // so carrying it in the body would have been silently inert.
    expect(body.output_format).toBeUndefined();
    expect(global.fetch.mock.calls[0][0]).toContain("?output_format=mp3_44100_128");
  });

  it("keeps the hardcoded defaults for settings the caller did not send", async () => {
    await say({ voice_settings: { stability: 0.9 } });
    expect(sentBody().voice_settings.similarity_boost).toBe(0.75);
  });

  it("behaves as before when no options are passed", async () => {
    await elevenlabs.synthesize("hello", MODEL, { apiKey: "k" });
    const body = sentBody();
    expect(body.text).toBe("hello");
    expect(body.model_id).toBe("eleven_multilingual_v2");
    expect(body.voice_settings).toEqual({ stability: 0.5, similarity_boost: 0.75 });
    expect(body.output_format).toBeUndefined();
  });

  it("a request cannot rewrite the text or the model the router resolved", async () => {
    await say({ text: "somewhere else", model_id: "eleven_someone_elses_model" });
    const body = sentBody();
    expect(body.text).toBe("hello");
    expect(body.model_id).toBe("eleven_multilingual_v2");
  });


  it("leaves the query string clean when no output_format is given", async () => {
    await say({ voice_settings: { stability: 0.9 } });
    expect(global.fetch.mock.calls[0][0]).not.toContain("?");
  });
});
