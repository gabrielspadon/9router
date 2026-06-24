import {
  isAnthropicCompatibleProvider,
  isOpenAICompatibleProvider,
} from "@/shared/constants/providers";
import { DEFAULT_CAPABILITIES, getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

export const LLM_KIND = "llm";

const RUNTIME_CAPABILITY_KEYS = [
  "vision",
  "pdf",
  "audioInput",
  "videoInput",
  "imageOutput",
  "audioOutput",
  "search",
  "reasoning",
];

export function parseOpenAIStyleModels(data) {
  if (Array.isArray(data)) return data;
  return data?.data || data?.models || data?.results || [];
}

// For dynamic/unknown model IDs (compatible providers, alias map, custom models)
// fall back to provider-level kind matching when per-model type is unavailable.
export function inferKindFromUnknownModelId(modelId) {
  const lower = String(modelId).toLowerCase();
  if (/embed/.test(lower)) return "embedding";
  if (/tts|speech|audio|voice/.test(lower)) return "tts";
  if (/image|imagen|dall-?e|flux|sdxl|sd-|stable-diffusion/.test(lower)) return "image";
  return LLM_KIND;
}

export function stripKnownModelPrefix(modelId, aliases) {
  for (const alias of aliases) {
    if (alias && modelId.startsWith(`${alias}/`)) {
      return modelId.slice(alias.length + 1);
    }
  }
  return modelId;
}

function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string").map((item) => item.toLowerCase());
  if (typeof value === "string") return [value.toLowerCase()];
  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([, enabled]) => enabled === true)
      .map(([key]) => key.toLowerCase());
  }
  return [];
}

function hasAny(values, names) {
  return values.some((value) => names.some((name) => value === name || value.includes(name)));
}

function addInputModalities(caps, values) {
  if (hasAny(values, ["image", "vision", "input_image", "image_url"])) caps.vision = true;
  if (hasAny(values, ["pdf", "document", "file"])) caps.pdf = true;
  if (hasAny(values, ["audio", "input_audio"])) caps.audioInput = true;
  if (hasAny(values, ["video", "input_video"])) caps.videoInput = true;
}

function addOutputModalities(caps, values) {
  if (hasAny(values, ["image", "output_image"])) caps.imageOutput = true;
  if (hasAny(values, ["audio", "output_audio"])) caps.audioOutput = true;
}

function addCapabilityFlags(caps, value) {
  if (!value) return;
  const values = normalizeList(value);
  if (values.length > 0) {
    if (hasAny(values, ["vision", "input_image", "image_url", "image_input", "supports_images"])) caps.vision = true;
    if (hasAny(values, ["pdf", "document", "file"])) caps.pdf = true;
    if (hasAny(values, ["audio_input", "input_audio"])) caps.audioInput = true;
    if (hasAny(values, ["video_input", "input_video"])) caps.videoInput = true;
    if (hasAny(values, ["image_output", "output_image", "text2image", "text2img", "image_generation"])) caps.imageOutput = true;
    if (hasAny(values, ["audio_output", "output_audio"])) caps.audioOutput = true;
    if (hasAny(values, ["tool", "function_call"])) caps.tools = true;
    if (hasAny(values, ["reasoning", "thinking"])) caps.reasoning = true;
    if (hasAny(values, ["search", "web_search"])) caps.search = true;
  }

  if (typeof value !== "object" || Array.isArray(value)) return;
  const lowerKeys = Object.fromEntries(Object.entries(value).map(([key, flag]) => [key.toLowerCase(), flag]));
  if (lowerKeys.vision === true || lowerKeys.supportsimages === true || lowerKeys.supports_images === true || lowerKeys.image_input === true) caps.vision = true;
  if (lowerKeys.pdf === true || lowerKeys.document === true || lowerKeys.file === true) caps.pdf = true;
  if (lowerKeys.audioinput === true || lowerKeys.audio_input === true) caps.audioInput = true;
  if (lowerKeys.videoinput === true || lowerKeys.video_input === true) caps.videoInput = true;
  if (lowerKeys.imageoutput === true || lowerKeys.image_output === true) caps.imageOutput = true;
  if (lowerKeys.audiooutput === true || lowerKeys.audio_output === true) caps.audioOutput = true;
  if (lowerKeys.tools === true || lowerKeys.tool_call === true || lowerKeys.tool_calls === true || lowerKeys.function_calling === true) caps.tools = true;
  if (lowerKeys.reasoning === true || lowerKeys.thinking === true) caps.reasoning = true;
  if (lowerKeys.search === true || lowerKeys.web_search === true) caps.search = true;
}

export function capabilitiesFromLiveModel(model) {
  if (!model || typeof model !== "object" || Array.isArray(model)) return null;

  const caps = {};
  const inputModalities = [
    ...normalizeList(model?.modalities?.input),
    ...normalizeList(model?.modalities?.inputs),
    ...normalizeList(model?.capabilities?.input),
    ...normalizeList(model?.capabilities?.inputs),
    ...normalizeList(model?.capabilities?.modalities?.input),
    ...normalizeList(model?.capabilities?.modalities?.inputs),
    ...normalizeList(model?.architecture?.input_modalities),
    ...normalizeList(model?.input_modalities),
    ...normalizeList(model?.supported_input_modalities),
  ];
  const outputModalities = [
    ...normalizeList(model?.modalities?.output),
    ...normalizeList(model?.modalities?.outputs),
    ...normalizeList(model?.capabilities?.output),
    ...normalizeList(model?.capabilities?.outputs),
    ...normalizeList(model?.capabilities?.modalities?.output),
    ...normalizeList(model?.capabilities?.modalities?.outputs),
    ...normalizeList(model?.architecture?.output_modalities),
    ...normalizeList(model?.output_modalities),
    ...normalizeList(model?.supported_output_modalities),
  ];

  addInputModalities(caps, inputModalities);
  addOutputModalities(caps, outputModalities);
  addCapabilityFlags(caps, model.modalities);
  addCapabilityFlags(caps, model.supported_modalities);
  addCapabilityFlags(caps, model.architecture);
  addCapabilityFlags(caps, model.capabilities);
  addCapabilityFlags(caps, model.supported_capabilities);
  addCapabilityFlags(caps, model.features);

  return Object.keys(caps).length > 0 ? caps : null;
}

export function runtimeCapabilitiesForModel(providerId, modelId) {
  const caps = getCapabilitiesForModel(providerId, modelId);
  const out = {};

  for (const key of RUNTIME_CAPABILITY_KEYS) {
    if (caps[key] === true && caps[key] !== DEFAULT_CAPABILITIES[key]) {
      out[key] = true;
    }
  }
  if (caps.thinkingFormat && caps.thinkingFormat !== DEFAULT_CAPABILITIES.thinkingFormat) {
    out.thinkingFormat = caps.thinkingFormat;
  }

  return Object.keys(out).length > 0 ? out : null;
}

function normalizeModelEntry(model) {
  if (typeof model === "string") {
    const id = model.trim();
    return id ? { id } : null;
  }
  const id = model?.id || model?.name || model?.model;
  if (typeof id !== "string" || id.trim() === "") return null;
  const capabilities = capabilitiesFromLiveModel(model);
  return {
    id: id.trim(),
    ...(typeof model?.name === "string" && model.name.trim() !== "" ? { name: model.name.trim() } : {}),
    ...(capabilities ? { capabilities } : {}),
  };
}

export async function fetchCompatibleModels(connection) {
  if (!connection?.apiKey) return [];

  const baseUrl = typeof connection?.providerSpecificData?.baseUrl === "string"
    ? connection.providerSpecificData.baseUrl.trim().replace(/\/$/, "")
    : "";

  if (!baseUrl) return [];

  const headers = {
    "Content-Type": "application/json",
  };
  let url;

  if (isOpenAICompatibleProvider(connection.provider)) {
    url = `${baseUrl}/models`;
    headers.Authorization = `Bearer ${connection.apiKey}`;
  } else if (isAnthropicCompatibleProvider(connection.provider)) {
    const catalogBaseUrl = baseUrl.endsWith("/messages/models")
      ? baseUrl.slice(0, -"/messages/models".length)
      : baseUrl.endsWith("/messages")
        ? baseUrl.slice(0, -"/messages".length)
        : baseUrl;
    url = `${catalogBaseUrl}/models`;
    headers["x-api-key"] = connection.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers.Authorization = `Bearer ${connection.apiKey}`;
  } else {
    return [];
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));

    if (!response.ok) return [];

    const data = await response.json();
    const rawModels = parseOpenAIStyleModels(data);
    const models = rawModels.map(normalizeModelEntry).filter(Boolean);
    const seen = new Set();

    return models.filter((model) => {
      if (seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    });
  } catch {
    return [];
  }
}

export async function fetchCompatibleModelIds(connection) {
  const models = await fetchCompatibleModels(connection);
  return models.map((model) => model.id);
}
