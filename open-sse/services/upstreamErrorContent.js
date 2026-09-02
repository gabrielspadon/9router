/**
 * Detect an upstream failure that arrived as a successful completion.
 *
 * Several upstreams answer HTTP 200 while putting their error INTO the assistant
 * content: Codex emits "Our servers are currently overloaded. Please try again
 * later.", NaraRouter emits an "Upstream error" line, and the CommandCode
 * translator turns an upstream `error` event into a `[CommandCode error: {...}]`
 * text block with finish_reason "stop". Downstream that reads as the model's
 * answer, so no fallback fires and the error is written into the conversation
 * history as if the model had said it.
 *
 * Detection is deliberately conservative, because a false positive discards a
 * real answer. Two rules only, and both require the error to be essentially the
 * WHOLE response rather than a substring of a longer one.
 */

// A provider wrapping an upstream error as text. Two shapes are in use:
//   [CommandCode error: {"type":"server_error","statusCode":503,...}]
//   [qoder error 429: rate limited]
// so the HTTP status between "error" and the colon is optional. Both are marker
// forms this codebase emits itself, which is why the rule carries no
// false-positive risk: a model does not write them.
const STRUCTURED_MARKER = /\[([A-Za-z][\w.\- ]{0,40}) error(?:\s+(\d{3}))?:\s*([\s\S]*)\]\s*$/;

// Whole-content prose signatures. Each names a service condition no model would
// produce as an answer. Matched only against a SHORT whole content, never as a
// substring of a real reply — see MAX_PROSE_ERROR_LENGTH.
const PROSE_SIGNATURES = [
  "servers are currently overloaded",
  "service temporarily unavailable",
  "upstream error",
  "model call unauthorized",
  "model call rejected",
  "upstream stream ended before terminal chunk",
  // A third-party proxy fronting a provider (opencode reverse proxies, #3228)
  // answers a 429 with HTTP 200 and the rate-limit text as the assistant's
  // content instead of a real non-200 status, so no fallback fires and the
  // combo/account loop never tries the next proxy.
  "rate limit exceeded",
  "too many requests",
];

// An upstream error blurb is a sentence or two. A genuine answer that happens to
// discuss one of the signatures above is almost always longer, and the cost of
// being wrong in that rare case is one retry on another account rather than a
// poisoned conversation.
const MAX_PROSE_ERROR_LENGTH = 300;

/**
 * @param {string} text - The assistant content of an HTTP 200 response
 * @returns {{ reason: string, retryable: boolean, status: number|null }|null}
 *   null when the content is a normal answer.
 */
export function detectUpstreamErrorContent(text) {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;

  const structured = trimmed.match(STRUCTURED_MARKER);
  if (structured) {
    const [, label, markerStatus, payload] = structured;
    let parsed = null;
    try { parsed = JSON.parse(payload.trim()); } catch { /* not JSON; the marker alone is enough */ }
    // isRetryable is the upstream's own word for it. Absent, assume retryable:
    // rotating to another account is the safe default for an unclassified
    // upstream error, and a genuinely permanent one fails again immediately.
    const retryable = parsed && typeof parsed.isRetryable === "boolean" ? parsed.isRetryable : true;
    const status = parsed && Number.isFinite(parsed.statusCode)
      ? parsed.statusCode
      : (markerStatus ? Number(markerStatus) : null);
    const detail = (parsed && (parsed.message || parsed.type)) || payload.trim().slice(0, 120);
    return { reason: `${label} upstream error: ${detail}`, retryable, status };
  }

  if (trimmed.length > MAX_PROSE_ERROR_LENGTH) return null;
  const lower = trimmed.toLowerCase();
  const hit = PROSE_SIGNATURES.find((sig) => lower.includes(sig));
  if (!hit) return null;
  return { reason: `upstream error in content: ${trimmed.slice(0, 120)}`, retryable: true, status: null };
}
