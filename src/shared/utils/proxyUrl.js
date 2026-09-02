/**
 * Accept the shorthand forms people paste from a proxy vendor, not only a full
 * protocol:// URL.
 *
 * The proxy-pool importer already accepted `host:port:user:pass`, while the
 * per-connection proxy field ran the raw string through `new URL()` and rejected
 * anything without a scheme. Same product, same paste, two answers (#962).
 *
 * Normalising here rather than at each caller means a form added to one input is
 * available to the other.
 */
const PROXY_PROTOCOLS = new Set([
  "http:", "https:", "socks:", "socks4:", "socks4a:", "socks5:", "socks5h:",
]);

/**
 * @param {string} value  raw user input
 * @returns {string|null} a full proxy URL, or null when the input is not one
 */
export function normalizeProxyUrl(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return null;

  // Already a URL: accept it only if the scheme is one a proxy agent can use, and
  // return it VERBATIM. new URL().toString() normalises — it appends a trailing
  // slash to "http://host:9999" — and that value is stored on the connection and
  // propagated into transport options, so rewriting it here would silently
  // change data this function is only supposed to validate.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      return PROXY_PROTOCOLS.has(new URL(trimmed).protocol) ? trimmed : null;
    } catch {
      return null;
    }
  }

  // Vendor shorthand. Credentials are encoded because a password containing @
  // or : would otherwise re-parse as a different host.
  const parts = trimmed.split(":");
  const build = (host, port, user, pass) => {
    if (!host || !port || !/^\d+$/.test(port)) return null;
    const auth = user ? `${encodeURIComponent(user)}:${encodeURIComponent(pass ?? "")}@` : "";
    try {
      return new URL(`http://${auth}${host}:${port}`).toString();
    } catch {
      return null;
    }
  };
  if (parts.length === 2) return build(parts[0], parts[1]);
  if (parts.length === 4) {
    const [host, port, user, pass] = parts;
    return user && pass ? build(host, port, user, pass) : null;
  }
  return null;
}

export { PROXY_PROTOCOLS };
