import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as getVoices } from "../../src/app/api/v1/audio/voices/route.js";
import { GET as getModelInfo } from "../../src/app/api/v1/models/info/route.js";
import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";
import { UPDATER_CONFIG } from "@/shared/constants/config";

const LOOPBACK_BASE = `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;

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
    const [target, init] = global.fetch.mock.calls[0];
    expect(init.cache).toBe("no-store");
    // The self-call authenticates itself: /api/media-providers is behind the
    // dashboard deny-by-default and a server-side fetch has no session cookie
    // (#1551). Asserted as a property so the shape can gain fields without
    // this test pinning the defect it was written before.
    expect(init.headers["x-tp-cli-token"]).toBeTruthy();
    expect(target).toBe(
      provider === "minimax"
        ? `${LOOPBACK_BASE}/api/media-providers/tts/minimax/voices`
        : `${LOOPBACK_BASE}/api/media-providers/tts/minimax/voices?provider=minimax-cn`,
    );
  });

  // The target is derived from loopback, never from the request's own origin: `origin`
  // comes from the Host header, so honouring it would aim this server-side fetch wherever
  // the caller asked.
  it("ignores a forged Host header when dialling the internal voices API", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ byLang: {} }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    await getVoices(new Request("http://169.254.169.254/v1/audio/voices?provider=minimax"));

    // The load-bearing assertion is the TARGET, not the init: a forged Host must
    // not redirect this server-side fetch.
    const [target, init] = global.fetch.mock.calls[0];
    expect(target).toBe(`${LOOPBACK_BASE}/api/media-providers/tts/minimax/voices`);
    expect(target).not.toContain("169.254.169.254");
    expect(init.cache).toBe("no-store");
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
