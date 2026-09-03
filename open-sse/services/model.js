import REGISTRY from "../providers/registry/index.js";
import { PROVIDER_MODELS } from "../config/providerModels.js";

// Alias→id derived from registry single-source: id→id, alias→id, aliases[]→id.
// Media-only providers without a registry transport entry keep explicit aliases here.
export const MEDIA_ONLY_ALIASES = Object.freeze({
  el: "elevenlabs",
  jina: "jina-ai",
  "jina-ai": "jina-ai",
  polly: "aws-polly",
  "aws-polly": "aws-polly",
});

const ALIAS_TO_PROVIDER_ID = { ...MEDIA_ONLY_ALIASES };
for (const entry of REGISTRY) {
  ALIAS_TO_PROVIDER_ID[entry.id] = entry.id;
  if (entry.uiAlias) ALIAS_TO_PROVIDER_ID[entry.uiAlias] = entry.id;
  if (entry.alias) ALIAS_TO_PROVIDER_ID[entry.alias] = entry.id;
  for (const a of entry.aliases || []) ALIAS_TO_PROVIDER_ID[a] = entry.id;
}

const BUILTIN_MODEL_ALIASES = {
  "grok-build": "gcli/grok-build",
};

// Connection-less catalog providers (noAuth + live modelsFetcher) strip their
// provider prefix upstream and echo the bare id back. The listing emits their
// models as `${alias}/${id}`, so the response echo must use the same form for
// clients that validate the echo against /v1/models.
const CONNECTIONLESS_CATALOG_ALIASES = new Map();
for (const entry of REGISTRY) {
  if (entry.noAuth && entry.modelsFetcher && entry.alias) {
    CONNECTIONLESS_CATALOG_ALIASES.set(entry.id, entry.alias);
  }
}

/**
 * Model name a response should echo back to the client. Prefixed requests keep
 * their exact form (already listing-valid). Bare requests that resolved to a
 * connection-less catalog provider get the listing form re-injected — e.g.
 * bare "big-pickle" → "oc/big-pickle" — so re-sending the echoed name routes
 * again and passes listing validation instead of triggering client warnings.
 */
export function canonicalEchoModel({ requestedModel, provider, model }) {
  if (!requestedModel || requestedModel.includes("/")) return requestedModel;
  const alias = CONNECTIONLESS_CATALOG_ALIASES.get(provider);
  if (alias) return `${alias}/${model}`;
  return requestedModel;
}

/**
 * Resolve provider alias to provider ID
 */
export function resolveProviderAlias(aliasOrId) {
  return ALIAS_TO_PROVIDER_ID[aliasOrId] || aliasOrId;
}

/**
 * Deterministic owner for a bare model name from the static registry catalog.
 * Returns the provider ID that declares `modelStr`, or null when no static
 * provider declares it. A provider can opt into a bare-model prefix only for
 * ids it declares. Other collisions resolve to an id/alias prefix, then the
 * first registry declaration.
 */
export function resolveBareModelStaticOwner(modelStr) {
  if (!modelStr) return null;
  const owners = [];
  for (const [alias, models] of Object.entries(PROVIDER_MODELS)) {
    if (Array.isArray(models) && models.some((m) => m && m.id === modelStr)) {
      owners.push(alias);
    }
  }
  if (owners.length === 0) return null;
  if (owners.length === 1) return resolveProviderAlias(owners[0]);
  const declaredPrefixOwner = REGISTRY.find(
    (entry) =>
      entry.bareModelPrefixes?.some((prefix) => modelStr.startsWith(prefix)) &&
      owners.some((alias) => resolveProviderAlias(alias) === entry.id),
  );
  if (declaredPrefixOwner) return declaredPrefixOwner.id;
  const byPrefix = owners.find((alias) => modelStr.startsWith(alias));
  if (byPrefix) return resolveProviderAlias(byPrefix);
  // Same id shipped by several providers (e.g. opencode-go and opencode-zen
  // share the OpenCode catalog): the first registry declaration wins so the
  // name never falls through to blind prefix inference.
  return resolveProviderAlias(owners[0]);
}

/**
 * Parse model string: "alias/model" or "provider/model" or just alias
 */
export function parseModel(modelStr) {
  if (!modelStr) {
    return { provider: null, model: null, isAlias: false, providerAlias: null };
  }

  // Check if standard format: provider/model or alias/model
  if (modelStr.includes("/")) {
    const firstSlash = modelStr.indexOf("/");
    const providerOrAlias = modelStr.slice(0, firstSlash);
    const model = modelStr.slice(firstSlash + 1);
    const provider = resolveProviderAlias(providerOrAlias);
    return { provider, model, isAlias: false, providerAlias: providerOrAlias };
  }

  // Alias format (model alias, not provider alias)
  return {
    provider: null,
    model: modelStr,
    isAlias: true,
    providerAlias: null,
  };
}

/**
 * Resolve model alias from aliases object
 * Format: { "alias": "provider/model" }
 */
export function resolveModelAliasFromMap(alias, aliases) {
  if (!aliases) return null;

  // Check if alias exists
  const resolved = aliases[alias];
  if (!resolved) return null;

  // Resolved value is "provider/model" format
  if (typeof resolved === "string" && resolved.includes("/")) {
    const firstSlash = resolved.indexOf("/");
    const providerOrAlias = resolved.slice(0, firstSlash);
    return {
      provider: resolveProviderAlias(providerOrAlias),
      model: resolved.slice(firstSlash + 1),
    };
  }

  // Or object { provider, model }
  if (typeof resolved === "object" && resolved.provider && resolved.model) {
    return {
      provider: resolveProviderAlias(resolved.provider),
      model: resolved.model,
    };
  }

  return null;
}

/**
 * Get full model info (parse or resolve)
 * @param {string} modelStr - Model string
 * @param {object|function} aliasesOrGetter - Aliases object or async function to get aliases
 */
export async function getModelInfoCore(modelStr, aliasesOrGetter) {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    return {
      provider: parsed.provider,
      model: parsed.model,
    };
  }

  // Get aliases (from object or function)
  const aliases =
    typeof aliasesOrGetter === "function"
      ? await aliasesOrGetter()
      : aliasesOrGetter;

  // Resolve alias
  const resolved =
    resolveModelAliasFromMap(parsed.model, aliases) ||
    resolveModelAliasFromMap(parsed.model, BUILTIN_MODEL_ALIASES);
  if (resolved) {
    return resolved;
  }

  // Static catalog declarations are a more specific ownership signal than a
  // generic name prefix. This keeps standalone open-sse callers aligned with
  // the dashboard resolver and avoids misrouting bare provider models.
  const staticOwner = resolveBareModelStaticOwner(parsed.model);
  if (staticOwner) {
    return { provider: staticOwner, model: parsed.model };
  }

  // Nothing claims this bare name: no custom model, no user alias, no static
  // registry declaration. The old fallback guessed a provider from a 5-entry
  // regex prefix table (defaulting to "openai" when nothing matched) and
  // silently forwarded the request to it — a fail-open self-healing violation
  // that routed a genuinely unknown model to a provider that never agreed to
  // serve it. Reject instead of guessing.
  throw new ModelNotFoundError(parsed.model);
}

/**
 * Thrown by getModelInfoCore when a bare model name matches no custom model,
 * user alias, or static registry declaration. `.status`/`.type`/`.code` mirror
 * ERROR_TYPES[404] in open-sse/config/errorConfig.js so a catching route can
 * shape a response with buildErrorBody(err.status, err.message) without
 * re-deriving them.
 */
export class ModelNotFoundError extends Error {
  constructor(modelName) {
    super(`Model not found: "${modelName}" is not in the catalog`);
    this.name = "ModelNotFoundError";
    this.status = 404;
    this.type = "invalid_request_error";
    this.code = "model_not_found";
    this.model = modelName;
  }
}
