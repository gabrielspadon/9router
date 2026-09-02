/**
 * Move the deprecated Codex lifecycle-hook feature flag to its current name.
 * The current key wins when both are present so an explicit modern setting is
 * never replaced by stale configuration.
 */
export function migrateLegacyCodexHooks(config) {
  if (!config || typeof config !== "object") return config;

  const features = config.features;
  if (!features || typeof features !== "object" || !("codex_hooks" in features)) {
    return config;
  }

  const nextFeatures = { ...features };
  if (!("hooks" in nextFeatures)) {
    nextFeatures.hooks = nextFeatures.codex_hooks;
  }
  delete nextFeatures.codex_hooks;

  return { ...config, features: nextFeatures };
}
