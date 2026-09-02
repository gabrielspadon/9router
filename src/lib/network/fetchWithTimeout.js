export const DEFAULT_FETCH_TIMEOUT_MS = 10000;

/**
 * fetch() with a deadline that actually cancels the request.
 *
 * Racing fetch against a rejecting timer only stops the caller waiting — the
 * socket stays open until the upstream answers, so a hung host keeps holding a
 * connection. Aborting the controller ends the request itself.
 *
 * A caller that supplies its own `signal` already owns the deadline and is
 * passed through untouched.
 *
 * @param {string|URL|Function} url fetch implementation, or the URL when no
 *   custom fetch is supplied
 * @param {RequestInit|string|URL} [options] request options, or the URL when
 *   `url` is a fetch implementation
 * @param {number} [timeoutMs]
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const fetchImpl = typeof url === "function" ? url : fetch;
  const targetUrl = typeof url === "function" ? options : url;
  const requestOptions = typeof url === "function" ? arguments[2] ?? {} : options;
  const resolvedTimeoutMs =
    typeof url === "function" ? arguments[3] ?? DEFAULT_FETCH_TIMEOUT_MS : timeoutMs;

  if (requestOptions?.signal) return fetchImpl(targetUrl, requestOptions);

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Request timed out after ${resolvedTimeoutMs}ms`)),
    timeoutMs,
  );
  try {
    return await fetchImpl(targetUrl, { ...requestOptions, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
