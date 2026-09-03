import { DefaultExecutor } from './default.js';

/**
 * OpenRouterExecutor — specialized for the OpenRouter gateway.
 *
 * OpenRouter auto-routes every `model` lookup to one of its internal upstream
 * providers. For some models — e.g. `openrouter/fusion` — the primary upstream
 * is branded "Stealth" and is configured (upstream of tokenproxy) with an empty
 * `url` field, so requests fail with HTTP 502 "Invalid URL: " and plain retries
 * never clear it. The minimal, side-effect-free mitigation is to set
 * `provider: { allow_fallbacks: true }` on every outbound request, which lets
 * OpenRouter route to an alternate upstream when the primary's route is broken.
 */
export class OpenRouterExecutor extends DefaultExecutor {
  constructor() {
    super('openrouter');
  }

  /**
   * Request OpenRouter's provider-fallback routing on chat calls.
   * Three input shapes, ordered by how cautiously we mutate:
   *  - missing   → inject `{ allow_fallbacks: true }` (default opt-in).
   *  - object    → shallow-merge `allow_fallbacks: true` only when the caller
   *                hasn't already set it (preserve user intent).
   *  - non-object (string name `provider: "Azure"`, array) → leave untouched;
   *                the caller has explicitly pinned a provider / opt-out set.
   */
  transformRequest(model, body, stream, credentials, sourceFormat) {
    const transformed = super.transformRequest(model, body, stream, credentials, sourceFormat);
    if (!transformed || typeof transformed !== 'object') return transformed;

    const existing = transformed.provider;
    if (existing === undefined || existing === null) {
      transformed.provider = { allow_fallbacks: true };
    } else if (typeof existing === 'object' && !Array.isArray(existing)) {
      if (existing.allow_fallbacks === undefined) {
        transformed.provider = { ...existing, allow_fallbacks: true };
      }
    }
    // Ask the gateway for authoritative usage. Without it OpenRouter reports no
    // token counts at all on a streamed turn and this router falls back to a
    // character-count estimate, so every streamed request is billed against a
    // guess. `usage.include` covers the JSON path; `stream_options.include_usage`
    // is the Chat Completions spelling the SSE path needs, and it is what makes
    // the trailing usage-only chunk arrive at all.
    transformed.usage = { ...transformed.usage, include: true };
    if (transformed.stream) {
      transformed.stream_options = { ...transformed.stream_options, include_usage: true };
    }

    return transformed;
  }

  /**
   * Opt in to OpenRouter per-generation metadata, but only for a caller that
   * asked for it.
   *
   * Whitelisted rather than forwarded: `forwardClientHeaders` passes any `x-`
   * header through, so a caller could already send this one — the point of the
   * explicit branch is that the header this router emits carries exactly the
   * literal `enabled` and reaches only the OpenRouter route, whatever the
   * caller sent. Metadata costs an extra upstream lookup, so it stays off by
   * default.
   */
  buildHeaders(creds, stream = true, url, model) {
    const headers = super.buildHeaders(creds, stream, url, model);
    if (creds?.rawHeaders?.["x-openrouter-metadata"] === "enabled") {
      headers["X-OpenRouter-Metadata"] = "enabled";
    }
    return headers;
  }
}
