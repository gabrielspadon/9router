// Issue #3656: Gemini is a media provider for image and chat but not for video,
// so the Video page offered only xAI even though Veo runs on the same key the
// user has already connected. The transparent proxy in videoCore is xAI-shaped
// and Veo matches none of it — an api-key header, a :predictLongRunning verb on
// the model, its own body, and an operation NAME back rather than an id — which
// is why this is an adapter.
import { describe, expect, it, vi, beforeEach } from "vitest";
import adapter, { toVeoBody, readOperation, ownsRequestId } from "open-sse/handlers/videoProviders/gemini.js";
import { getVideoAdapter, findVideoAdapterForRequestId } from "open-sse/handlers/videoProviders/index.js";
import { AI_PROVIDERS } from "@/shared/constants/providers";

const OP = "models/veo-3.1-lite-generate-preview/operations/abc123";
const creds = { apiKey: "AIza-test" };
let fetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  global.fetch = fetchMock;
});

const ok = (payload) => ({ ok: true, status: 200, text: async () => JSON.stringify(payload) });

describe("the request body Veo takes (#3656)", () => {
  it("puts the prompt on an instance, as the API expects", () => {
    expect(toVeoBody({ prompt: "a cat" })).toEqual({ instances: [{ prompt: "a cat" }] });
  });

  it("passes an explicit aspect ratio through", () => {
    expect(toVeoBody({ prompt: "x", aspect_ratio: "16:9" }).parameters).toEqual({ aspectRatio: "16:9" });
  });

  it("derives an aspect ratio from an OpenAI-style size", () => {
    expect(toVeoBody({ prompt: "x", size: "1920x1080" }).parameters.aspectRatio).toBe("16:9");
    expect(toVeoBody({ prompt: "x", size: "1080x1920" }).parameters.aspectRatio).toBe("9:16");
  });

  it("carries duration and negative prompt when asked", () => {
    const body = toVeoBody({ prompt: "x", duration_seconds: 8, negative_prompt: "blur" });
    expect(body.parameters).toMatchObject({ durationSeconds: 8, negativePrompt: "blur" });
  });

  it("takes an inline data URI as bytes rather than a URI", () => {
    const body = toVeoBody({ prompt: "x", image: "data:image/png;base64,QUJD" });
    expect(body.instances[0].image).toEqual({ bytesBase64Encoded: "QUJD", mimeType: "image/png" });
  });

  it("omits parameters entirely when nothing was asked for", () => {
    expect(toVeoBody({ prompt: "x" }).parameters).toBeUndefined();
  });
});

describe("reading an operation (#3656)", () => {
  it("reports pending while it is not done", () => {
    expect(readOperation({ name: OP, done: false })).toEqual({ request_id: `veo:${OP}`, status: "pending" });
  });

  it("returns the video URI in the envelope xAI already uses", () => {
    const done = { name: OP, done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://x/y:download?alt=media" } }] } } };
    expect(readOperation(done)).toEqual({
      request_id: `veo:${OP}`, status: "completed", video: { url: "https://x/y:download?alt=media" },
    });
  });

  it("reads the other shapes the preview API returns", () => {
    for (const response of [
      { generateVideoResponse: { generatedVideos: [{ video: { uri: "u" } }] } },
      { generatedSamples: [{ video: { url: "u" } }] },
      { generatedVideos: [{ uri: "u" }] },
    ]) {
      expect(readOperation({ name: OP, done: true, response }).video).toEqual({ url: "u" });
    }
  });

  it("surfaces an operation error rather than reporting completion", () => {
    const r = readOperation({ name: OP, done: true, error: { message: "quota" } });
    expect(r).toMatchObject({ status: "failed", error: "quota" });
  });

  it("calls a done operation with no video a failure, not a completed job", () => {
    expect(readOperation({ name: OP, done: true, response: {} }).status).toBe("failed");
  });
});

describe("create and poll (#3656)", () => {
  it("posts predictLongRunning with the api-key header and returns the operation as the request id", async () => {
    fetchMock.mockResolvedValue(ok({ name: OP }));
    const result = await adapter.create({ model: "veo-3.1-lite-generate-preview", body: { prompt: "a cat" }, credentials: creds });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(":predictLongRunning");
    expect(init.headers["x-goog-api-key"]).toBe("AIza-test");
    expect(init.headers.Authorization).toBeUndefined();
    expect(await result.response.json()).toEqual({ request_id: `veo:${OP}`, status: "pending" });
  });

  it("polls the operation name it was given, not a base plus an id", async () => {
    fetchMock.mockResolvedValue(ok({ name: OP, done: false }));
    await adapter.poll({ requestId: `veo:${OP}`, credentials: creds });
    expect(fetchMock.mock.calls[0][0]).toBe(`https://generativelanguage.googleapis.com/v1beta/${OP}`);
  });

  it("refuses without a key instead of calling upstream", async () => {
    const r = await adapter.create({ model: "veo-3.1-lite-generate-preview", body: {}, credentials: {} });
    expect(r.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not report a job it cannot address", async () => {
    fetchMock.mockResolvedValue(ok({}));
    const r = await adapter.create({ model: "veo-3.1-lite-generate-preview", body: { prompt: "x" }, credentials: creds });
    expect(r.success).toBe(false);
  });

  it("never re-sends a creation POST after a network error", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    const r = await adapter.create({ model: "veo-3.1-lite-generate-preview", body: { prompt: "x" }, credentials: creds });
    expect(r.success).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("passes an upstream error status and text through", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => "quota exceeded" });
    const r = await adapter.create({ model: "veo-3.1-lite-generate-preview", body: { prompt: "x" }, credentials: creds });
    expect(r.status).toBe(429);
    expect(r.error).toContain("quota exceeded");
  });
});

describe("routing (#3656)", () => {
  it("owns its own poll ids and no one else's", () => {
    expect(ownsRequestId(`veo:${OP}`)).toBe(true);
    expect(ownsRequestId("xai-request-id")).toBe(false);
    expect(findVideoAdapterForRequestId(`veo:${OP}`)).toBe(adapter);
    expect(findVideoAdapterForRequestId("xai-request-id")).toBeNull();
  });

  it("is registered under the provider the registry names", () => {
    expect(getVideoAdapter("gemini")).toBe(adapter);
    expect(getVideoAdapter("xai")).toBeNull();
  });

  it("the registry declares video for gemini with the three Veo models", () => {
    const gemini = AI_PROVIDERS["gemini"];
    expect(gemini.serviceKinds).toContain("video");
    expect(gemini.videoConfig.adapter).toBe("gemini");
    for (const id of ["veo-3.1-generate-preview", "veo-3.1-fast-generate-preview", "veo-3.1-lite-generate-preview"]) {
      expect(gemini.videoConfig.models).toContain(id);
    }
  });
});
