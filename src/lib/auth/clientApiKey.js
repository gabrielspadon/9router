function queryApiKey(request) {
  const searchParams = request?.nextUrl?.searchParams;
  if (searchParams?.get) return searchParams.get("key");
  try {
    return new URL(request?.url).searchParams.get("key");
  } catch {
    return null;
  }
}

/**
 * Return all API-key credentials supplied by a client in protocol precedence
 * order. This is pure on purpose: callers decide how and where to validate.
 */
export function collectClientApiKeyCandidates(request) {
  const candidates = [];
  const push = (value) => {
    if (typeof value === "string" && value && !candidates.includes(value)) candidates.push(value);
  };
  const authorization = request?.headers?.get?.("Authorization");
  if (authorization?.startsWith("Bearer ")) push(authorization.slice(7));
  push(request?.headers?.get?.("x-api-key"));
  push(request?.headers?.get?.("x-goog-api-key"));
  push(queryApiKey(request));
  return candidates;
}

/**
 * Validate every credential the client presents and retain only the first one
 * that the gateway recognizes. Callers must use a valid result for downstream
 * attribution and never log the raw candidates.
 */
export async function resolveClientApiKey(request, validate) {
  const candidates = collectClientApiKeyCandidates(request);
  for (const apiKey of candidates) {
    if (await validate(apiKey)) return { apiKey, valid: true };
  }
  return { apiKey: candidates[0] || null, valid: false };
}
