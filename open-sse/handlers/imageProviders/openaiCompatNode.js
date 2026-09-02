// Custom node providers (openai-compatible-*) — baseUrl from the connection
// rather than from a registry entry, so a user-declared endpoint can serve
// /v1/images/generations.
//
// Chat and embeddings already worked this way (see
// embeddingProviders/openaiCompatNode.js); image generation had no equivalent,
// so "custom media providers" was only ever true for text (#2197).
import createOpenAIAdapter from "./openai.js";

const baseAdapter = createOpenAIAdapter("openai");

export default {
  ...baseAdapter,
  // An edit endpoint is not derivable for an arbitrary node, so every request
  // goes to the generation path — the same choice the embedding node makes.
  buildUrl: (_model, creds) => {
    const raw = creds?.providerSpecificData?.baseUrl || creds?.baseUrl || "https://api.openai.com/v1";
    const baseUrl = String(raw).replace(/\/+$/, "").replace(/\/images\/generations$/, "");
    return `${baseUrl}/images/generations`;
  },
};
