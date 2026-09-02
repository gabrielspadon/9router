// OpenAI-compatible embeddings adapter (most providers)
import { bearerAuth } from "./_base.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";
import { getProviderModels } from "../../config/providerModels.js";

// media-only providers without a registry file keep URL here; rest derive from registry media.embeddingConfig.baseUrl
const ENDPOINTS = {
  "jina-ai": "https://api.jina.ai/v1/embeddings",
};

const embedCfg = (id) => PROVIDER_MEDIA[id]?.embeddingConfig || {};
const embedUrl = (id) => embedCfg(id).baseUrl || ENDPOINTS[id];

// Does this provider's registry row for `model` list `param` as required?
// Model ids reach the adapter both bare and vendor-prefixed, so match either.
function declaresRequiredParam(providerId, model, param) {
  const row = getProviderModels(providerId).find(
    (m) => m.id === model || m.id?.split("/").pop() === String(model).split("/").pop()
  );
  return Array.isArray(row?.params) && row.params.includes(param);
}

export default function createOpenAIEmbeddingAdapter(providerId) {
  const cfg = embedCfg(providerId);
  return {
    buildUrl: () => embedUrl(providerId),
    buildHeaders: (creds) => {
      return { "Content-Type": "application/json", ...bearerAuth(creds), ...(cfg.headers || {}) };
    },
    buildBody: (model, { input, encoding_format, dimensions, input_type }) => {
      const body = { model, input };
      if (encoding_format) body.encoding_format = encoding_format;
      // Asymmetric embedding models (e.g. NVIDIA NIM nvidia/llama-nemotron-embed-*)
      // require input_type ("query" | "passage"); forward it when the client sends it.
      if (input_type != null && input_type !== "") body.input_type = input_type;
      // A generic OpenAI client does not know the field exists, so the request
      // failed with 400 "'input_type' parameter is required for asymmetric
      // models" and no route to a working call (#1378). The registry already
      // declared which models require it and nothing read that; fall back to the
      // retrieval-time meaning, which is what the report asked for. A client
      // embedding passages for an index still sends its own value above.
      else if (declaresRequiredParam(providerId, model, "input_type")) {
        body.input_type = "query";
      }
      if (dimensions != null && dimensions !== "") {
        const dim = Number(dimensions);
        if (Number.isFinite(dim) && dim > 0) body.dimensions = dim;
      }
      return body;
    },
    normalize: (responseBody) => responseBody,
  };
}
