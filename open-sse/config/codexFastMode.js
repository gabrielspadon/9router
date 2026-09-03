const CODEX_SOL_FAST_MODELS = new Set([
  "gpt-5.6-sol",
  "gpt-5.6-sol-review",
]);

// Codex accepts exactly these three service tiers. `fast` is a legacy client
// spelling of `priority` and is an ALIAS, never a tier of its own: it resolves
// to priority and disappears. Anything else — an unknown string, a non-string —
// is dropped rather than guessed at, because an unrecognized tier answers
// routing_unsupported upstream. Failure is therefore by OMISSION, never by
// substituting a tier the caller did not ask for.
const CODEX_SERVICE_TIERS = new Set(["default", "priority", "ultrafast"]);
const CODEX_SERVICE_TIER_ALIASES = { fast: "priority" };

/**
 * Resolve a client service tier to the value Codex is sent, or undefined when
 * the request carries no tier this gateway can forward. THE single point every
 * outbound Codex body normalizes its tier at — see CodexExecutor.transformRequest.
 *
 * @param {unknown} tier
 * @returns {string|undefined}
 */
export function normalizeCodexServiceTier(tier) {
  if (typeof tier !== "string") return undefined;
  const value = tier.trim();
  const resolved = CODEX_SERVICE_TIER_ALIASES[value] ?? value;
  return CODEX_SERVICE_TIERS.has(resolved) ? resolved : undefined;
}

function normalizeModelId(model) {
  if (typeof model !== "string") return "";
  const unqualified = model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : model;
  return unqualified.replace(/\s*\([^()]+\)\s*$/, "");
}

export function applyCodexFastMode(
  body,
  {
    provider,
    model,
    enabled,
    clientServiceTierSpecified = false,
    clientServiceTier,
  } = {},
) {
  if (
    !body
    || typeof body !== "object"
    || Array.isArray(body)
    || provider !== "codex"
  ) {
    return body;
  }

  if (Object.prototype.hasOwnProperty.call(body, "service_tier")) return body;
  if (clientServiceTierSpecified) {
    return { ...body, service_tier: clientServiceTier };
  }
  if (enabled !== true || !CODEX_SOL_FAST_MODELS.has(normalizeModelId(model))) {
    return body;
  }

  return { ...body, service_tier: "priority" };
}
