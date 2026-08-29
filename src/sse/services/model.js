// Re-export from open-sse with localDb integration
import {
  getModelAliases,
  getCustomModels,
  getComboByName,
  getProviderNodes,
} from "@/lib/localDb";
import {
  parseModel as parseModelCore,
  resolveModelAliasFromMap,
  getModelInfoCore,
  resolveProviderAlias,
  resolveBareModelStaticOwner,
} from "open-sse/services/model.js";
import { getFreeModelsForProvider } from "@/lib/db/repos/freeModelsRepo.js";

// Local provider alias overrides (HMR-friendly, applied on top of open-sse map)
const LOCAL_PROVIDER_ALIASES = {
  xmtp: "xiaomi-tokenplan",
  "xiaomi-tokenplan": "xiaomi-tokenplan",
};

export function parseModel(modelStr) {
  const parsed = parseModelCore(modelStr);
  if (parsed?.providerAlias && LOCAL_PROVIDER_ALIASES[parsed.providerAlias]) {
    return {
      ...parsed,
      provider: LOCAL_PROVIDER_ALIASES[parsed.providerAlias],
    };
  }
  return parsed;
}

/**
 * Resolve model alias from localDb
 */
export async function resolveModelAlias(alias) {
  const aliases = await getModelAliases();
  return resolveModelAliasFromMap(alias, aliases);
}

/**
 * Get full model info (parse or resolve)
 */
export async function getModelInfo(modelStr) {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    // Provider-node prefixes are user-defined. Check custom nodes first — if the
    // user explicitly created a node with a given prefix, route to it even when
    // the prefix collides with a built-in provider id/alias (e.g. a custom
    // "tokenrouter" node with prefix "tr"). The user's credentials are stored
    // under the node ID; routing to the built-in provider instead would fail
    // with "No credentials for provider". When no custom node matches, fall
    // through to the built-in provider resolution below.
    const openaiNodes = await getProviderNodes({ type: "openai-compatible" });
    const matchedOpenAI = openaiNodes.find(
      (node) => node.prefix === parsed.providerAlias,
    );
    if (matchedOpenAI) {
      return { provider: matchedOpenAI.id, model: parsed.model };
    }

    const anthropicNodes = await getProviderNodes({
      type: "anthropic-compatible",
    });
    const matchedAnthropic = anthropicNodes.find(
      (node) => node.prefix === parsed.providerAlias,
    );
    if (matchedAnthropic) {
      return { provider: matchedAnthropic.id, model: parsed.model };
    }

    const multiNodes = await getProviderNodes({ type: "multi-compatible" });
    const matchedMulti = multiNodes.find(
      (node) => node.prefix === parsed.providerAlias,
    );
    if (matchedMulti) {
      return { provider: matchedMulti.id, model: parsed.model };
    }

    const embeddingNodes = await getProviderNodes({ type: "custom-embedding" });
    const matchedEmbedding = embeddingNodes.find(
      (node) => node.prefix === parsed.providerAlias,
    );
    if (matchedEmbedding) {
      return { provider: matchedEmbedding.id, model: parsed.model };
    }

    return {
      provider: parsed.provider,
      model: parsed.model,
    };
  }

  // Check if this is a combo name before resolving as alias
  // This prevents combo names from being incorrectly routed to providers
  const combo = await getComboByName(parsed.model);
  if (combo) {
    // Return null provider to signal this should be handled as combo
    // The caller (handleChat) will detect this and handle it as combo
    return { provider: null, model: parsed.model };
  }

  // Bare (provider-less) model name: resolve to whichever provider actually
  // serves it (custom registry → static catalog → opencode free catalog),
  // before the generic prefix-inference fallback can blind-route it to the
  // wrong provider.
  const dynamic = await resolveBareModelToProvider(parsed.model);
  if (dynamic) {
    return dynamic;
  }

  return getModelInfoCore(modelStr, getModelAliases);
}

/**
 * Dynamic fallback for bare (provider-less) model names, in priority order:
 * 1. admin-registered custom models (explicit intent — wins over everything),
 * 2. user-defined model aliases (explicit intent — wins over catalog hits),
 * 3. the synced free-model catalog (opencode free tier — hourly fetch+cache
 *    via freeModelSync, no per-request fetch; checked first because the static
 *    registry also declares free-tier ids under opencode-go),
 * 4. static registry declarations (deterministic, no admin data needed).
 * This replaces the brittle hardcoded prefix→provider inference for opencode
 * free tier, mimo, and any other connection-less/providerless provider — a
 * bare name resolves to the real owner instead of being blind-routed to a
 * provider that will reject it.
 */
export async function resolveBareModelToProvider(modelStr) {
  try {
    const custom = await getCustomModels();
    const hit = custom.find(
      (m) => m && m.id === modelStr && (m.type === "llm" || !m.type),
    );
    if (hit && hit.providerAlias) {
      const provider = resolveProviderAlias(hit.providerAlias);
      return { provider, model: hit.id };
    }
  } catch {
    /* fail open: fall through to normal resolution */
  }

  // 2) user-defined model aliases — explicit intent, must win over catalog hits
  try {
    const aliases = await getModelAliases();
    const aliasHit = resolveModelAliasFromMap(modelStr, aliases);
    if (aliasHit) return aliasHit;
  } catch {
    /* fail open: fall through to normal resolution */
  }

  try {
    // Connection-less providers with a synced free catalog: ids are stored per
    // provider id by freeModelSync. Checked before the static scan because the
    // fork's static registry also declares free-tier ids under opencode-go,
    // and the free-tier (noAuth) provider is the intended owner of its names.
    for (const id of ["opencode", "mimo-free"]) {
      const entry = await getFreeModelsForProvider(id);
      if (entry?.ids?.includes(modelStr)) {
        return { provider: id, model: modelStr };
      }
    }
  } catch {
    /* fail open: fall through to normal resolution */
  }

  const staticOwner = resolveBareModelStaticOwner(modelStr);
  if (staticOwner) {
    return { provider: staticOwner, model: modelStr };
  }

  return null;
}

/**
 * Check if model is a combo and get models list
 * @returns {Promise<string[]|null>} Array of models or null if not a combo
 */
export async function getComboModels(modelStr) {
  // Resolve combo by full name first, then by basename (part after the last
  // slash) so client configs like `provider/combo-name` still hit the combo
  // instead of forwarding the raw string to the upstream provider.
  let combo = await getComboByName(modelStr);
  if (!combo && modelStr.includes("/")) {
    combo = await getComboByName(modelStr.split("/").pop());
  }
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}
