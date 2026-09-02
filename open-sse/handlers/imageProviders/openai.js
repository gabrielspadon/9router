// OpenAI-compatible adapter (used by openai, minimax, openrouter, recraft)
import { PROVIDER_MEDIA } from "../../providers/index.js";

const imageCfg = (id) => PROVIDER_MEDIA[id]?.imageConfig || {};
const imageUrl = (id) => imageCfg(id).baseUrl;
const editCfg = (id) => PROVIDER_MEDIA[id]?.imageEditConfig || {};

// An edit carries a source image. A provider that declares an edit endpoint had
// it ignored here, so an edit request went to the generation endpoint with the
// image dropped and came back as a fresh image (#1608).
const isEdit = (body) => !!(body?.image || (Array.isArray(body?.images) && body.images.length));

// The edit endpoint is used only when this provider declares one AND the model
// is one it lists, because a declared endpoint that does not serve the requested
// model would turn a working generation into a 404.
function editEndpoint(providerId, model) {
  const edit = editCfg(providerId);
  if (!edit.baseUrl) return null;
  if (Array.isArray(edit.models) && edit.models.length && !edit.models.includes(model)) return null;
  return edit;
}

export default function createOpenAIAdapter(providerId) {
  const cfg = imageCfg(providerId);
  return {
    buildUrl: (model, _credentials, body) => {
      if (isEdit(body)) {
        const edit = editEndpoint(providerId, model);
        if (edit) return edit.baseUrl;
      }
      return imageUrl(providerId);
    },
    buildHeaders: (creds) => {
      const headers = { "Content-Type": "application/json", ...(cfg.headers || {}) };
      const key = creds?.apiKey || creds?.accessToken;
      if (key) headers["Authorization"] = `Bearer ${key}`;
      return headers;
    },
    buildBody: (model, body) => {
      const { prompt, n = 1, size = "1024x1024", quality, style, response_format } = body;
      const full = { model, prompt, n, size };
      if (quality) full.quality = quality;
      if (style) full.style = style;
      if (response_format) full.response_format = response_format;

      // On an edit the source image is the point of the request, so it travels
      // and the edit entry's own field whitelist decides the rest.
      const edit = isEdit(body) ? editEndpoint(providerId, model) : null;
      if (edit) {
        full.image = body.image || body.images[0];
        if (Array.isArray(body.images) && body.images.length > 1) full.images = body.images;
        if (Array.isArray(edit.bodyFields)) {
          const req = {};
          for (const f of edit.bodyFields) if (full[f] !== undefined) req[f] = full[f];
          return req;
        }
        return full;
      }

      // bodyFields whitelist (e.g. xAI accepts only model/prompt/n/response_format)
      if (Array.isArray(cfg.bodyFields)) {
        const req = {};
        for (const f of cfg.bodyFields) if (full[f] !== undefined) req[f] = full[f];
        return req;
      }
      return full;
    },
    normalize: (responseBody) => responseBody,
  };
}
