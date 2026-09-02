// MiniMax image generation.
//
// This provider was served by the OpenAI-compatible adapter, which posts the
// OpenAI body to the OpenAI path. MiniMax's image API is neither: the path is
// /v1/image_generation, the size is an aspect ratio rather than a WxH string,
// and the endpoint lives on the .io host while chat lives on .com. Posting the
// OpenAI shape to the OpenAI path is why the test returned a 404 page (#2482).
import { nowSec, sizeToAspectRatio } from "./_base.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";

const cfg = () => PROVIDER_MEDIA["minimax"]?.imageConfig || {};

// The documented request fields. `n` is 1..9 and `aspect_ratio` is one of a
// fixed set, so a size we cannot map falls back to the API's own default
// rather than being sent as an unknown value.
const ASPECT_RATIOS = new Set(["1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16", "21:9"]);

function clampCount(n) {
  const parsed = Number(n);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(9, Math.max(1, Math.floor(parsed)));
}

// The response shape is not identical across MiniMax's own documentation and
// the OpenAI-compatible proxies that front it, so read every form rather than
// betting on one: an array of objects with a url or a base64 field, an array of
// bare strings, or an object carrying image_urls.
function collectImages(responseBody) {
  const data = responseBody?.data;
  const out = [];

  const push = (value, revised) => {
    if (typeof value !== "string" || !value) return;
    const item = /^https?:\/\//i.test(value) ? { url: value } : { b64_json: value };
    if (revised) item.revised_prompt = revised;
    out.push(item);
  };

  if (Array.isArray(data)) {
    for (const entry of data) {
      if (typeof entry === "string") push(entry);
      else push(entry?.url || entry?.image_url || entry?.b64_json || entry?.image, entry?.revised_prompt);
    }
  } else if (data && typeof data === "object") {
    for (const value of data.image_urls || data.images || []) push(value);
  }

  return out;
}

export default {
  buildUrl: () => cfg().baseUrl,

  buildHeaders: (creds) => {
    const headers = { "Content-Type": "application/json", ...(cfg().headers || {}) };
    const key = creds?.apiKey || creds?.accessToken;
    if (key) headers["Authorization"] = `Bearer ${key}`;
    return headers;
  },

  buildBody: (model, body) => {
    const req = {
      model,
      prompt: body?.prompt,
      n: clampCount(body?.n),
      // The caller speaks OpenAI, so it sends a WxH size; MiniMax takes a ratio.
      aspect_ratio: ASPECT_RATIOS.has(body?.aspect_ratio)
        ? body.aspect_ratio
        : sizeToAspectRatio(body?.size),
    };
    if (body?.response_format) req.response_format = body.response_format;
    return req;
  },

  normalize: (responseBody) => {
    // Already the OpenAI shape (a proxy fronting MiniMax): pass it through.
    if (responseBody?.created && Array.isArray(responseBody?.data)) return responseBody;

    // MiniMax reports failure in a status envelope with HTTP 200, so a body
    // carrying a non-zero status must not be normalized into an empty success.
    const status = responseBody?.base_resp;
    if (status && Number(status.status_code) !== 0) {
      const message = status.status_msg || `MiniMax error ${status.status_code}`;
      const error = new Error(message);
      error.status = 502;
      throw error;
    }

    return { created: nowSec(), data: collectImages(responseBody) };
  },
};
