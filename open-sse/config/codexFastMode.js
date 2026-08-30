const CODEX_SOL_FAST_MODELS = new Set([
  "gpt-5.6-sol",
  "gpt-5.6-sol-review",
]);

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
    || enabled !== true
    || !CODEX_SOL_FAST_MODELS.has(normalizeModelId(model))
  ) {
    return body;
  }

  if (Object.prototype.hasOwnProperty.call(body, "service_tier")) return body;
  if (clientServiceTierSpecified) {
    return { ...body, service_tier: clientServiceTier };
  }

  return { ...body, service_tier: "priority" };
}
