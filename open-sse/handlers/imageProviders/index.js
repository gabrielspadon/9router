// Image provider adapter registry
import createOpenAIAdapter from "./openai.js";
import gemini from "./gemini.js";
import codex from "./codex.js";
import sdwebui from "./sdwebui.js";
import comfyui from "./comfyui.js";
import huggingface from "./huggingface.js";
import nanobanana from "./nanobanana.js";
import falAi from "./falAi.js";
import stabilityAi from "./stabilityAi.js";
import blackForestLabs from "./blackForestLabs.js";
import runwayml from "./runwayml.js";
import cloudflareAi from "./cloudflareAi.js";
import antigravity from "./antigravity.js";
import minimax from "./minimax.js";
import openaiCompatNode from "./openaiCompatNode.js";

const ADAPTERS = {
  openai: createOpenAIAdapter("openai"),
  minimax,
  openrouter: createOpenAIAdapter("openrouter"),
  recraft: createOpenAIAdapter("recraft"),
  "vercel-ai-gateway": createOpenAIAdapter("vercel-ai-gateway"),
  xai: createOpenAIAdapter("xai"),
  gemini,
  codex,
  sdwebui,
  comfyui,
  huggingface,
  nanobanana,
  antigravity,
  "fal-ai": falAi,
  "stability-ai": stabilityAi,
  "black-forest-labs": blackForestLabs,
  runwayml,
  "cloudflare-ai": cloudflareAi,
};

// A user-declared OpenAI-compatible node has no registry entry, so its endpoint
// lives on the connection. Same test the embedding registry uses (#2197).
const isCustomNode = (provider) =>
  typeof provider === "string" && provider.startsWith("openai-compatible-");

export function getImageAdapter(provider) {
  if (isCustomNode(provider)) return openaiCompatNode;
  return ADAPTERS[provider] || null;
}

export function isImageProvider(provider) {
  return isCustomNode(provider) || provider in ADAPTERS;
}
