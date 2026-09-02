// Forward the client's own custom headers to the upstream.
//
// An agent that sets X-Title, HTTP-Referer or X-Session-ID expects them to
// reach the provider, because that is how several providers attribute usage and
// how the agent correlates its own traces. TokenProxy dropped all of them (#2413).
//
// Forwarding is deliberately narrow:
//
//   - Only headers this router has not already set. Auth, protocol version and
//     any identity a provider hook chose all win, so a client cannot override
//     the credential it is being routed with, and cloaking that sets its own
//     User-Agent is not undone by the client's.
//   - Only `x-` prefixed names plus the two attribution headers providers
//     actually read. A blanket forward would send the client's Cookie and
//     Accept-Encoding to a third party and break framing.
//   - Never the deny list below, which is auth, framing, our own internal
//     headers, and the ones with deliberate handling elsewhere.
const DENIED = new Set([
  // Auth belongs to the connection, never to the caller.
  "authorization", "proxy-authorization", "x-api-key", "api-key", "x-goog-api-key",
  // Framing and hop-by-hop.
  "host", "content-length", "content-type", "connection", "transfer-encoding",
  "accept-encoding", "te", "trailer", "upgrade", "expect", "keep-alive",
  // The caller's session with US is not the provider's business.
  "cookie", "set-cookie",
  // Handled deliberately elsewhere; forwarding would fight that logic.
  "anthropic-version", "anthropic-beta", "x-app",
  // Stamped by custom-server from the socket, or internal to this router.
  "x-forwarded-for", "x-real-ip",
]);

const ATTRIBUTION = new Set(["user-agent", "referer", "http-referer"]);

function isForwardable(name) {
  const lower = name.toLowerCase();
  if (DENIED.has(lower)) return false;
  // Internal peer-token and IP stamping, whatever the suffix.
  if (lower.startsWith("x-tp-")) return false;
  return lower.startsWith("x-") || ATTRIBUTION.has(lower);
}

/**
 * Add the client's forwardable headers to an already-built upstream header set.
 * Mutates and returns `headers`, so the caller's own values always win.
 *
 * @param {Record<string,string>} headers - headers this router built
 * @param {Record<string,string>|null|undefined} rawHeaders - the client's headers
 * @returns {Record<string,string>}
 */
export function forwardClientHeaders(headers, rawHeaders) {
  if (!rawHeaders || typeof rawHeaders !== "object") return headers;
  const alreadySet = new Set(Object.keys(headers).map((k) => k.toLowerCase()));
  for (const [name, value] of Object.entries(rawHeaders)) {
    if (typeof value !== "string" || !value) continue;
    if (alreadySet.has(name.toLowerCase())) continue;
    if (!isForwardable(name)) continue;
    headers[name] = value;
  }
  return headers;
}

export { DENIED as DENIED_CLIENT_HEADERS };

// Headers no one may set, whoever they are, because they describe the HTTP
// framing of the request this router is building rather than its content.
// An operator overriding Content-Length or Transfer-Encoding does not
// configure a provider, it corrupts the message.
const FRAMING = new Set([
  "host", "content-length", "connection", "transfer-encoding",
  "te", "trailer", "upgrade", "expect", "keep-alive",
]);

/**
 * Apply the operator's own per-connection headers.
 *
 * Distinct from forwardClientHeaders above, and the distinction is the whole
 * point: that one carries the CALLER's headers and must never touch auth, this
 * one carries the OPERATOR's configuration and must be able to. An endpoint
 * behind an API gateway authenticates with its own header rather than a bearer
 * token (Azure APIM's Ocp-Apim-Subscription-Key is the common case), and a
 * generic openai-compatible connection had no way to say so: the auth
 * descriptor hardcodes bearer and nothing read a per-connection override, so
 * those endpoints were unreachable (#2660).
 *
 * Applied AFTER this router's own headers so the operator's choice wins, and
 * BEFORE the caller's passthrough so the caller still cannot override it.
 *
 * @param {Record<string,string>} headers - headers this router built
 * @param {object|null|undefined} providerSpecificData - the connection's config
 * @returns {Record<string,string>}
 */
export function applyOperatorHeaders(headers, providerSpecificData) {
  const custom = providerSpecificData?.customHeaders;
  if (!custom || typeof custom !== "object" || Array.isArray(custom)) return headers;
  for (const [name, value] of Object.entries(custom)) {
    if (typeof name !== "string" || !name.trim()) continue;
    const lower = name.toLowerCase();
    if (FRAMING.has(lower)) continue;
    // An empty string is how an operator removes a header this router would
    // otherwise send, which is the only way to talk to an endpoint that
    // rejects one of our defaults.
    if (value === "") {
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === lower) delete headers[key];
      }
      continue;
    }
    if (typeof value !== "string") continue;
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === lower && key !== name) delete headers[key];
    }
    headers[name] = value;
  }
  return headers;
}
