// The upstream's own id for a generation, forwarded to the client as a response
// header.
//
// Why it matters: a gateway bills and logs per generation id, so a user
// disputing a charge, or an operator correlating a slow turn against the
// upstream's dashboard, needs the id the UPSTREAM used. TokenProxy's own
// request id identifies the proxy hop, not the inference, and no other field
// on the response carries the upstream's.
//
// Why the allowlist rather than a sanitizer: this value is attacker-influenced.
// It arrives on a response from a third party and is written straight into a
// header this proxy emits, so a CR or LF in it splits the response and lets the
// upstream inject headers of its own choosing into a reply the client trusts.
// A strict allowlist fails closed — anything outside it is DROPPED, never
// repaired, because a repaired id is not the upstream's id and a partial match
// is not evidence of anything.
//
// The 200-character ceiling is part of the guard: an unbounded header from an
// upstream is a cheap way to blow a client's or an intermediary's header
// budget.
const SAFE_GENERATION_ID = /^[A-Za-z0-9._:-]{1,200}$/;

export const GENERATION_ID_HEADER = "X-Generation-Id";
const UPSTREAM_GENERATION_ID_HEADER = "x-generation-id";

/**
 * The generation id from an upstream response, or null when there is none that
 * is safe to forward.
 *
 * @param {{ headers?: { get?: (name: string) => string|null } }} providerResponse
 * @returns {string|null}
 */
export function safeGenerationId(providerResponse) {
  const raw = providerResponse?.headers?.get?.(UPSTREAM_GENERATION_ID_HEADER);
  return typeof raw === "string" && SAFE_GENERATION_ID.test(raw) ? raw : null;
}

/**
 * Merge the generation-id header into a header set for the client response.
 * Returns a new object; the input is untouched. Adds nothing when the upstream
 * sent no id, or sent one that fails the allowlist.
 *
 * @param {Record<string,string>} headers
 * @param {object} providerResponse
 * @returns {Record<string,string>}
 */
export function withGenerationIdHeader(headers, providerResponse) {
  const id = safeGenerationId(providerResponse);
  return id ? { ...headers, [GENERATION_ID_HEADER]: id } : { ...headers };
}
