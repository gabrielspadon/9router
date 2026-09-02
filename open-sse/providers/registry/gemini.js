import { GOOGLE_OAUTH_CLIENT } from "../shared.js";

export default {
  id: "gemini",
  priority: 50,
  hasFree: true,
  alias: "gemini",
  display: {
    name: "Gemini",
    icon: "diamond",
    color: "#4285F4",
    textIcon: "GE",
    website: "https://ai.google.dev",
    notice: {
      apiKeyUrl: "https://aistudio.google.com/app/apikey",
    },
  },
  category: "freeTier",
  authType: "apikey",
  authModes: ["apikey"],
  mediaPriority: 1,
  transport: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    format: "gemini",
    clientId: "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
    clientSecret: "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",
    auth: {
      apiKey: {
        header: "x-goog-api-key",
        scheme: "raw",
      },
      oauth: {
        header: "Authorization",
        scheme: "bearer",
      },
    },
  },
  // Catalog checked against ai.google.dev/gemini-api/docs/deprecations on
  // 2026-08-31. Ids whose published shutdown date has passed are repointed at
  // Google's own recommended replacement: gemini-3.1-flash-lite-preview (shut
  // down 2026-05-25), gemini-3.1-flash-image-preview and gemini-3-pro-image-preview
  // (both 2026-06-25), text-embedding-004 (2026-01-14), embedding-001 (2025-10-30,
  // dropped, gemini-embedding-2 covers it) and the gemini-2.0-flash STT entry
  // (2026-06-01). gemini-2.5-flash / -pro / -flash-lite carry NO shutdown date on
  // that page, so they stay listed.
  models: [
    { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash" },
    { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash" },
    { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite" },
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
    { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite" },
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
    { id: "gemma-4-31b-it", name: "Gemma 4 31B IT" },
    { id: "gemini-embedding-2-preview", name: "Gemini Embedding 2 Preview", kind: "embedding" },
    { id: "gemini-embedding-001", name: "Gemini Embedding 001", kind: "embedding" },
    { id: "text-embedding-005", name: "Text Embedding 005", kind: "embedding" },
    { id: "gemini-embedding-2", name: "Gemini Embedding 2", kind: "embedding" },
    { id: "gemini-3.1-flash-image", name: "Gemini 3.1 Flash Image (Nano Banana 2)", params: [], kind: "image" },
    { id: "gemini-3-pro-image", name: "Gemini 3 Pro Image (Nano Banana Pro)", params: [], kind: "image" },
    { id: "gemini-2.5-flash-image", name: "Gemini 2.5 Flash Image (Nano Banana)", params: [], kind: "image" },
    { id: "veo-3.1-generate-preview", name: "Veo 3.1", params: ["aspect_ratio","duration_seconds","negative_prompt","image"], kind: "video" },
    { id: "veo-3.1-fast-generate-preview", name: "Veo 3.1 Fast", params: ["aspect_ratio","duration_seconds","negative_prompt","image"], kind: "video" },
    { id: "veo-3.1-lite-generate-preview", name: "Veo 3.1 Lite", params: ["aspect_ratio","duration_seconds","negative_prompt","image"], kind: "video" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro (Best)", params: ["language","prompt"], kind: "stt" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", params: ["language","prompt"], kind: "stt" },
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite (Cheapest)", params: ["language","prompt"], kind: "stt" },
    { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", params: ["language","prompt"], kind: "stt" },
    { id: "gemini-3.1-flash-tts-preview", name: "Gemini 3.1 Flash TTS", kind: "tts" },
    { id: "gemini-2.5-flash-preview-tts", name: "Gemini 2.5 Flash TTS", kind: "tts" },
    { id: "gemini-2.5-pro-preview-tts", name: "Gemini 2.5 Pro TTS", kind: "tts" },
  ],
  serviceKinds: ["llm","embedding","image","imageToText","webSearch","tts","stt","video"],
  ttsConfig: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    authType: "apikey",
    authHeader: "key",
    format: "gemini-tts",
  },
  sttConfig: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    authType: "apikey",
    authHeader: "key",
    format: "gemini-stt",
  },
  embeddingConfig: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/models", authType: "apikey", authHeader: "key" },
  imageConfig: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/models" },
  // Veo. Named as an adapter rather than a base URL because Veo matches none of
  // the transparent proxy's assumptions: an api-key header, a
  // :predictLongRunning verb on the model, its own request body, and an
  // OPERATION NAME back instead of an id, so a poll target cannot be rebuilt
  // from a base and an id (#3656). open-sse/handlers/videoProviders/gemini.js
  // serves it and answers the same { request_id, status, video } envelope xAI
  // does, so nothing downstream learns a second shape.
  videoConfig: {
    adapter: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    models: [
      "veo-3.1-generate-preview",
      "veo-3.1-fast-generate-preview",
      "veo-3.1-lite-generate-preview",
    ],
  },
  searchViaChat: {
    defaultModel: "gemini-2.5-flash",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    pricingUrl: "https://ai.google.dev/pricing",
    freeTier: "Free tier: 15 RPM, 1M tokens/day on gemini-2.5-flash via AI Studio.",
  },
};
