import os from "os";
import path from "path";

/**
 * Pi (pi.dev, earendil-works/pi) keeps custom providers in a single JSON file,
 * `~/.pi/agent/models.json`, shaped `{ providers: { <name>: {...} } }`.
 *
 * The merge lives here rather than in the route because it is the part that can
 * lose data: TokenProxy writes the WHOLE file back, so every provider, model,
 * header and compat block the user had must survive the round trip. The route
 * pairs this with `readExistingConfig`, which refuses to hand back `{}` for a
 * file it could not parse — the two together are what keep an apply from
 * replacing a config it never read.
 *
 * Schema reference: packages/coding-agent/docs/models.md in earendil-works/pi.
 */
export const PROVIDER_KEY = "tokenproxy";
export const PI_API = "openai-completions";

export const getPiConfigDir = () => path.join(os.homedir(), ".pi", "agent");
export const getPiConfigPath = () => path.join(getPiConfigDir(), "models.json");

/** Pi wants the OpenAI-compatible root, same as every other openai-completions provider. */
export const normalizeBaseUrl = (baseUrl) =>
  String(baseUrl).replace(/\/+$/, "").endsWith("/v1")
    ? String(baseUrl).replace(/\/+$/, "")
    : `${String(baseUrl).replace(/\/+$/, "")}/v1`;

export const hasTokenProxy = (config) => Boolean(config?.providers?.[PROVIDER_KEY]);

export function getTokenProxyModelIds(config) {
  const models = config?.providers?.[PROVIDER_KEY]?.models;
  return Array.isArray(models) ? models.map((m) => m?.id).filter(Boolean) : [];
}

/**
 * Merge TokenProxy into an existing Pi config without dropping anything else.
 *
 * @param {object|null} existing  parsed models.json, or null when absent
 * @param {{baseUrl: string, apiKey?: string, models: string[]}} opts
 * @returns {object} the config to write back
 */
export function mergePiProvider(existing, { baseUrl, apiKey, models }) {
  if (existing !== null && existing !== undefined && (typeof existing !== "object" || Array.isArray(existing))) {
    throw new Error(`${getPiConfigPath()} is not a Pi config object; refusing to overwrite it`);
  }

  const config = { ...(existing || {}) };
  config.providers = { ...(config.providers || {}) };

  const previous = config.providers[PROVIDER_KEY] || {};
  // Keep the user's own additions on this provider (headers, compat, modelOverrides,
  // authHeader) and overwrite only what the dashboard actually owns.
  const provider = {
    ...previous,
    baseUrl: normalizeBaseUrl(baseUrl),
    api: previous.api || PI_API,
    apiKey: apiKey || previous.apiKey || "sk_tokenproxy",
  };

  // Union by model id: an entry the user hand-tuned (contextWindow, cost,
  // reasoning) keeps those fields; a genuinely new id gets the defaults.
  const byId = new Map();
  for (const entry of Array.isArray(previous.models) ? previous.models : []) {
    if (entry?.id) byId.set(entry.id, entry);
  }
  for (const id of models) {
    if (!id || typeof id !== "string") continue;
    byId.set(id, byId.get(id) || { id, input: ["text", "image"] });
  }
  provider.models = [...byId.values()];

  config.providers[PROVIDER_KEY] = provider;
  return config;
}

/**
 * Remove one model, or the whole TokenProxy provider when `modelId` is null.
 * Returns the config to write back; every other provider is untouched.
 */
export function removePiProvider(existing, modelId = null) {
  const config = { ...(existing || {}) };
  if (!config.providers?.[PROVIDER_KEY]) return config;

  config.providers = { ...config.providers };

  if (!modelId) {
    delete config.providers[PROVIDER_KEY];
    return config;
  }

  const provider = { ...config.providers[PROVIDER_KEY] };
  provider.models = (Array.isArray(provider.models) ? provider.models : []).filter((m) => m?.id !== modelId);

  // A provider with no models left is dead weight in Pi's picker, so drop it.
  if (provider.models.length === 0) delete config.providers[PROVIDER_KEY];
  else config.providers[PROVIDER_KEY] = provider;

  return config;
}
