/**
 * Build the `providerSpecificData` a new connection is saved with.
 *
 * Kept out of the modal so the shape can be tested without rendering: the
 * saved value is what the executors read, and a connection saved without it
 * silently falls back to a built-in default — which is how self-hosted TTS and
 * STT connections ended up pointing at the 9router container itself (#3467).
 *
 * `baseUrl` is included for any provider whose registry entry declares a
 * `baseUrlField`, and only when the user actually typed something: an empty
 * box means "keep the provider's default", not "save an empty endpoint".
 */
export function buildProviderSpecificData({
  hasBaseUrlField = false,
  baseUrl = "",
  isAzure = false,
  azureData = null,
  isCloudflareAi = false,
  cloudflareData = null,
  region = "",
  hasRegions = false,
} = {}) {
  if (hasBaseUrlField) {
    const trimmed = String(baseUrl || "").trim();
    return trimmed ? { baseUrl: trimmed } : undefined;
  }
  if (isAzure) {
    return {
      azureEndpoint: azureData?.azureEndpoint,
      apiVersion: azureData?.apiVersion,
      deployment: azureData?.deployment,
      organization: azureData?.organization,
    };
  }
  if (isCloudflareAi) {
    return { accountId: cloudflareData?.accountId };
  }
  if (hasRegions && region) {
    return { region };
  }
  return undefined;
}

/**
 * Merge an edited Base URL into the `providerSpecificData` an existing
 * connection already stores (EditConnectionModal). Keys owned by other parts
 * of the form — proxy settings, region — are carried through untouched, and
 * clearing the field removes only `baseUrl` so the provider default applies.
 *
 * @param {object|null|undefined} providerSpecificData  the connection's current value
 * @param {string} baseUrl                              the field's raw value
 * @returns {object|undefined}                          undefined when nothing is left to store
 */
export function mergeBaseUrl(providerSpecificData, baseUrl) {
  const merged = { ...(providerSpecificData || {}) };
  const trimmed = typeof baseUrl === "string" ? baseUrl.trim() : "";

  if (trimmed) merged.baseUrl = trimmed;
  else delete merged.baseUrl;

  return Object.keys(merged).length > 0 ? merged : undefined;
}
