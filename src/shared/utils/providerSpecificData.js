/**
 * Build the `providerSpecificData` a new connection is saved with.
 *
 * Kept out of the modal so the shape can be tested without rendering: the
 * saved value is what the executors read, and a connection saved without it
 * silently falls back to a built-in default — which is how self-hosted TTS and
 * STT connections ended up pointing at the tokenproxy container itself (#3467).
 *
 * `baseUrl` is included for any provider whose registry entry declares a
 * `baseUrlField`, and only when the user actually typed something: an empty
 * box means "keep the provider's default", not "save an empty endpoint".
 *
 * `extraValues` carries any additional credential a provider needs beside its
 * API key, declared as `extraFields` on its registry entry. Google PSE needs a
 * search engine id alongside the key and had nowhere to put it, so every
 * connection failed its own test with "requires both apiKey and cx" (#3402).
 * Empty values are dropped for the same reason an empty base URL is.
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
  extraValues = null,
} = {}) {
  const extras = {};
  for (const [key, value] of Object.entries(extraValues || {})) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (trimmed) extras[key] = trimmed;
  }
  const withExtras = (data) => {
    if (!Object.keys(extras).length) return data;
    return { ...(data || {}), ...extras };
  };

  if (hasBaseUrlField) {
    const trimmed = String(baseUrl || "").trim();
    return withExtras(trimmed ? { baseUrl: trimmed } : undefined);
  }
  if (isAzure) {
    return withExtras({
      azureEndpoint: azureData?.azureEndpoint,
      apiVersion: azureData?.apiVersion,
      deployment: azureData?.deployment,
      organization: azureData?.organization,
    });
  }
  if (isCloudflareAi) {
    return withExtras({ accountId: cloudflareData?.accountId });
  }
  if (hasRegions && region) {
    return withExtras({ region });
  }
  return withExtras(undefined);
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
