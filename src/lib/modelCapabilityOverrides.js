import { getCustomModels } from "@/lib/db/repos/aliasRepo.js";
import { setModelCapabilityOverrides } from "open-sse/providers/capabilities.js";

/**
 * Build the per-model capability override map from the custom-model store and
 * hand it to the engine's resolver.
 *
 * A custom model is added by id alone, so a model the capabilities tables do not
 * recognise falls to DEFAULT_CAPABILITIES — vision:false — and every image in
 * the request is dropped with no way to say otherwise (#1904). The store already
 * carried maxInputTokens and maxOutputTokens per custom model and nothing ever
 * read them; this is the read side for all three.
 *
 * Keyed `${providerAlias}/${id}` so an override cannot leak onto another
 * provider that happens to serve the same model id. That is the same
 * provider-prefixed form lookupOverride() resolves first.
 */
export function buildModelCapabilityOverrides(customModels) {
  const map = new Map();
  for (const m of customModels || []) {
    if (!m?.providerAlias || !m?.id) continue;
    const caps = {};
    if (m.vision !== undefined) caps.vision = !!m.vision;
    if (m.maxInputTokens !== undefined) caps.contextWindow = m.maxInputTokens;
    if (m.maxOutputTokens !== undefined) caps.maxOutput = m.maxOutputTokens;
    if (Object.keys(caps).length === 0) continue;
    map.set(`${m.providerAlias}/${m.id}`, caps);
  }
  return map;
}

export async function refreshModelCapabilityOverrides() {
  setModelCapabilityOverrides(buildModelCapabilityOverrides(await getCustomModels()));
}
