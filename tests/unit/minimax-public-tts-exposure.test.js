import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as getVoices } from "../../src/app/api/v1/audio/voices/route.js";
import { GET as getModelInfo } from "../../src/app/api/v1/models/info/route.js";
import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";

const PROVIDERS = ["minimax", "minimax-cn"];
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe("public MiniMax TTS exposure", () => {
  it.each(PROVIDERS)("lists voices through the public audio API for %s", async (provider) => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        byLang: { English: { voices: [{ id: "voice-1", name: "Voice 1" }] } },
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const response = await getVoices(new Request(`http://localhost/v1/audio/voices?provider=${provider}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      object: "list",
      data: [{ id: "voice-1", name: "Voice 1", lang: "", gender: "", model: `${provider}/voice-1` }],
    });
    expect(global.fetch).toHaveBeenCalledWith(
      provider === "minimax"
        ? "http://localhost/api/media-providers/tts/minimax/voices"
        : "http://localhost/api/media-providers/tts/minimax/voices?provider=minimax-cn",
      { cache: "no-store" },
    );
  });

  it.each(PROVIDERS)("links %s TTS models to its public voices endpoint", async (provider) => {
    const model = PROVIDER_MODELS[provider].find((entry) => entry.kind === "tts");
    const response = await getModelInfo(
      new Request(`http://localhost/v1/models/info?id=${provider}/${encodeURIComponent(model.id)}&kind=tts`),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: `${provider}/${model.id}`,
      kind: "tts",
      voicesUrl: `/v1/audio/voices?provider=${provider}`,
    });
  });
});
